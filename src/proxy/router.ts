import type { ChatCompletionRequest, ProviderResult } from "./providers/base";
import { providers, getAllModels, type ProviderName, getNativeModelId } from "./providers/registry";
import { isNonAccountRequestError, isTransientError } from "./errors";
import { applyPudidilFilters } from "./filters";
import { pool } from "./pool";
import type { Account } from "../db/schema";
import {
  compressRequest,
  getCompressionConfig,
  type CompressionStats,
} from "./compression";
import { db } from "../db";
import { modelCombos } from "../db/schema";
import { eq, sql } from "drizzle-orm";

// Context limits for known models (in tokens)
const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "sonnet-4.5": 200000,
  "sonnet-4.6": 200000,
  "sonnet": 200000,
  "opus-4.5": 200000,
  "opus-4.6": 1000000,
  "opus-4.7": 1000000,
  "opus-4.8": 1000000,
  "haiku": 200000,
  "gemini-2.5": 200000,
  "gemini-3.0": 200000,
  "gemini-3.1": 1000000,
  "gemini-3.5": 1000000,
  "qwen3": 1000000,
  "qwen3.5": 1000000,
  "qwen3.6": 1000000,
  "qwen3.7": 1000000,
  "deepseek-v4": 1000000,
  "deepseek-v3": 1000000,
  "mimo": 1000000,
  "glm-5": 200000,
  "glm-5.1": 202745,
  "kiro": 200000,
  "codebuddy": 200000,
  "canva": 1000,
  "codex": 200000,
  "qoder": 180000,
  "byok": 200000,
};

function getContextLimit(modelId: string): number {
  // Check exact match first
  if (MODEL_CONTEXT_LIMITS[modelId]) return MODEL_CONTEXT_LIMITS[modelId];
  // Check partial match
  const lower = modelId.toLowerCase();
  for (const [key, limit] of Object.entries(MODEL_CONTEXT_LIMITS)) {
    if (lower.includes(key)) return limit;
  }
  // Default: assume 1M if unknown (safe fallback)
  return 1000000;
}

// Combo cache — invalidated on write via invalidateComboCache()
let _comboCache: Map<string, string[]> | null = null;

async function loadComboCache(): Promise<Map<string, string[]>> {
  if (_comboCache) return _comboCache;
  const rows = await db.select().from(modelCombos).where(eq(modelCombos.enabled, true));
  _comboCache = new Map();
  for (const row of rows) {
    const models = row.modelsJson as unknown as string[];
    if (Array.isArray(models) && models.length > 0) {
      _comboCache.set(row.name, models);
    }
  }
  return _comboCache;
}

export function invalidateComboCache() {
  _comboCache = null;
}

/**
 * Resolve a model name to either the same model (no combo) or a chain of models (combo).
 * With round-robin rotation and context-aware filtering.
 */
export async function resolveModelChain(modelName: string, requiredContext: number = 0): Promise<string[]> {
  const combos = await loadComboCache();
  const chain = combos.get(modelName);
  if (!chain) return [modelName];

  // 1. Filter models by context requirement
  const filtered = requiredContext > 0
    ? chain.filter(m => getContextLimit(m) >= requiredContext)
    : chain;

  // If all filtered out, fallback to full chain
  if (filtered.length === 0) return chain;

  // 2. Round-robin: get last used index and rotate
  try {
    const row = await db.select({ lastUsedIndex: modelCombos.lastUsedIndex }).from(modelCombos).where(eq(modelCombos.name, modelName)).get();
    const lastIndex = row?.lastUsedIndex ?? 0;

    // Rotate: start from next index
    const startIndex = (lastIndex + 1) % filtered.length;
    const rotated = [...filtered.slice(startIndex), ...filtered.slice(0, startIndex)];

    // Update last_used_index for next request
    const nextIndex = (lastIndex + 1) % filtered.length;
    await db.update(modelCombos).set({ lastUsedIndex: nextIndex, updatedAt: new Date() }).where(eq(modelCombos.name, modelName));

    return rotated;
  } catch {
    // If DB update fails, just return filtered chain
    return filtered;
  }
}

export interface RouteResult {
  result: ProviderResult;
  account: Account;
  provider: ProviderName;
  durationMs: number;
  compressionStats?: CompressionStats;
}

/** Check if a request contains image content blocks */
function requestHasImages(request: ChatCompletionRequest): boolean {
  return request.messages.some((msg) => {
    if (!Array.isArray(msg.content)) return false;
    return (msg.content as any[]).some(
      (block) => block?.type === "image_url" || block?.type === "image"
    );
  });
}

/**
 * Sanitize request by applying pudidil filters to all text content.
 * Strips Claude Code identity, billing headers, and other patterns
 * that trigger content moderation on upstream providers.
 */
function sanitizeRequest(request: ChatCompletionRequest): ChatCompletionRequest {
  const sanitized = { ...request };

  sanitized.messages = request.messages.map((msg) => {
    if (typeof msg.content === "string") {
      return { ...msg, content: applyPudidilFilters(msg.content) };
    }
    if (Array.isArray(msg.content)) {
      return {
        ...msg,
        content: (msg.content as any[]).map((block) => {
          if (block?.type === "text" && typeof block.text === "string") {
            return { ...block, text: applyPudidilFilters(block.text) };
          }
          if (block?.type === "tool_result") {
            if (typeof block.content === "string") {
              return { ...block, content: applyPudidilFilters(block.content) };
            }
            if (Array.isArray(block.content)) {
              return {
                ...block,
                content: block.content.map((inner: any) =>
                  inner?.type === "text" && typeof inner.text === "string"
                    ? { ...inner, text: applyPudidilFilters(inner.text) }
                    : inner
                ),
              };
            }
          }
          return block;
        }),
      };
    }
    return msg;
  });

  if (sanitized.tools) {
    sanitized.tools = request.tools!.map((tool: any) => {
      if (tool?.function?.description) {
        return {
          ...tool,
          function: {
            ...tool.function,
            description: applyPudidilFilters(tool.function.description),
          },
        };
      }
      return tool;
    });
  }

  return sanitized;
}

/**
 * Route a chat completion request to the appropriate provider/account.
 * Implements retry logic with fallback to next account and model chain fallback.
 */
export async function routeRequest(
  request: ChatCompletionRequest,
  stream: boolean
): Promise<RouteResult> {
/** Estimate total tokens from messages array */
function estimateMessagesTokens(messages: ChatCompletionRequest["messages"]): number {
  return (messages || []).reduce((total, msg) => {
    let content = "";
    if (typeof msg.content === "string") {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      content = (msg.content as any[])
        .map((block) => {
          if (block?.type === "text" && typeof block.text === "string") return block.text;
          return "";
        })
        .join("");
    }
    return total + Math.max(1, Math.ceil(content.length / 4));
  }, 0);
}

  // Apply content filters to strip the assistant identity, billing headers, etc.
  const sanitizedRequest = sanitizeRequest(request);

  // Resolve model chain — if the model is a combo name, get the ordered list of fallback models
  // Pass estimated prompt tokens for context-aware filtering
  const estimatedTokens = estimateMessagesTokens(sanitizedRequest.messages);
  const modelChain = await resolveModelChain(sanitizedRequest.model, estimatedTokens);

  const hasImages = requestHasImages(sanitizedRequest);

  // Try each model in the chain until one succeeds
  let lastChainError = "";
  for (let chainIdx = 0; chainIdx < modelChain.length; chainIdx++) {
    const currentModel = modelChain[chainIdx];
    if (!currentModel) continue;
    const providerName = pool.getProviderForModel(currentModel);
    if (!providerName) {
      lastChainError = `No provider found for model: ${currentModel}`;
      console.error(`[Combo] ${lastChainError}, trying next in chain...`);
      continue;
    }

    // Build request with resolved model
    const resolvedRequest: ChatCompletionRequest = { ...sanitizedRequest, model: currentModel };

    // Apply compression pipeline (RTK + DCP + Caveman + image dedupe + cache markers).
    // Failures here are non-fatal — fall back to the sanitized request and move on.
    let compressedRequest = resolvedRequest;
    let compressionStats: CompressionStats | undefined;
    try {
      const cfg = await getCompressionConfig();
      const out = compressRequest(resolvedRequest, cfg, providerName);
      compressedRequest = out.request;
      compressionStats = out.stats;
    } catch (err) {
      console.error("[Compression] Failed, passing request through unchanged:", err);
    }

    const provider = providers[providerName];
    if (!provider) {
      lastChainError = `Provider not configured: ${providerName}`;
      continue;
    }

    // Reject image requests for models that don't support vision
    if (hasImages) {
      const modelInfo = provider.getModelInfo(currentModel);
      if (modelInfo && !modelInfo.vision) {
        lastChainError = `Model "${currentModel}" does not support image/vision inputs`;
        console.error(`[Combo] ${lastChainError}, trying next in chain...`);
        continue;
      }
    }

    // Try up to 3 accounts before giving up
    const maxRetries = 3;
    let lastError = "";

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // BYOK uses prefix-based account lookup (not the generic pool),
    // so it can also find error-status accounts and retry them.
    const account = providerName === "byok"
      ? (await pool.getAccountForModel(compressedRequest.model))?.account ?? null
      : await pool.getNextAccount(providerName);
    if (!account) {
      throw new Error(
        `No active accounts available for provider: ${providerName}`
      );
    }

    const startTime = Date.now();
    let tracked = false;

    try {
      pool.trackRequestStart(account.id);
      tracked = true;
      const nativeModel = getNativeModelId(compressedRequest.model, providerName);
      const executionRequest = { ...compressedRequest, model: nativeModel };

      const result = stream
        ? await provider.chatCompletionStream(account, executionRequest)
        : await provider.chatCompletion(account, executionRequest);

      const durationMs = Date.now() - startTime;

      if (result.success) {
        // If provider refreshed tokens internally, persist them to database
        if (result.tokens) {
          await pool.updateTokens(account.id, result.tokens);
        }
        await pool.markUsed(account.id);

        // Restore the original prefixed model ID on the final response body
        if (result.response) {
          result.response.model = currentModel;
        }

        return { result, account, provider: providerName, durationMs, compressionStats };
      }

      pool.trackRequestEnd(account.id);
      tracked = false;

      // Client-side model errors should not poison accounts. A wrong model ID
      // is a bad request, not an account/session failure, so stop retrying and
      // let the API layer return an invalid_model response.
      if (isNonAccountRequestError(result.error)) {
        throw new Error(result.error || `Invalid model: ${compressedRequest.model}`);
      }

      // Handle rate limiting (429) — temporary, don't mark exhausted
      if (result.rateLimited) {
        lastError = result.error || "Rate limited";
        continue; // Try next account without poisoning this one
      }

      // Handle quota exhaustion (402 without PAYG)
      if (result.quotaExhausted) {
        await pool.markExhausted(account.id);
        lastError = result.error || "Quota exhausted";
        continue; // Try next account
      }

      // Handle token refresh
      if (
        result.error?.includes("expired") ||
        result.error?.includes("401")
      ) {
        const refreshResult = await provider.refreshToken(account);
        if (refreshResult.success && refreshResult.tokens) {
          // Parse tokens string to store as jsonb
          let parsedTokens: unknown;
          try {
            parsedTokens = JSON.parse(refreshResult.tokens);
          } catch {
            parsedTokens = refreshResult.tokens;
          }
          await pool.updateTokens(account.id, parsedTokens);
          // Retry with same account after refresh
          pool.trackRequestStart(account.id);
          tracked = true;
          const retryResult = stream
            ? await provider.chatCompletionStream(account, compressedRequest)
            : await provider.chatCompletion(account, compressedRequest);

          if (retryResult.success) {
            await pool.markUsed(account.id);
            return {
              result: retryResult,
              account,
              provider: providerName,
              durationMs: Date.now() - startTime,
              compressionStats,
            };
          }
          pool.trackRequestEnd(account.id);
          tracked = false;
        }
        await pool.markTransientFailure(account.id, result.error || "Auth failed");
        lastError = result.error || "Auth failed";
        continue;
      }

      // Generic error - check if transient (network/timeout) or permanent
      if (isTransientError(result.error || "")) {
        await pool.markTransientFailure(account.id, result.error || "Transient error");
      } else {
        await pool.markTransientFailure(account.id, result.error || "Unknown error");
      }
      lastError = result.error || "Unknown error";
    } catch (error) {
      const errMsg =
        error instanceof Error ? error.message : String(error);
      if (tracked) {
        pool.trackRequestEnd(account.id);
        tracked = false;
      }
      if (isNonAccountRequestError(errMsg)) {
        throw error;
      }
      if (errMsg.includes("expired") || errMsg.includes("401")) {
        await pool.markTransientFailure(account.id, errMsg);
      } else if (isTransientError(errMsg)) {
        await pool.markTransientFailure(account.id, errMsg);
      } else {
        await pool.markTransientFailure(account.id, errMsg);
      }
      lastError = errMsg;
    }
  }

  // All accounts failed for this model — if there are more models in the chain, try the next one
  lastChainError = `All accounts failed for ${providerName} (model: ${currentModel}). Last error: ${lastError}`;
  console.error(`[Combo] ${lastChainError}, trying next in chain...`);
  continue;
}

  // All models in the chain failed
  throw new Error(
    `All models in combo chain failed. Original model: ${sanitizedRequest.model}. Last error: ${lastChainError}`
  );
}

// Re-exported from the provider registry (single source of truth). Kept as
// named exports here so existing import sites (proxy/index.ts, api/stats.ts,
// auth/runner.ts, api/image-studio.ts, auth/warmup-runner.ts) stay unchanged.
export { providers, getAllModels, type ProviderName };
