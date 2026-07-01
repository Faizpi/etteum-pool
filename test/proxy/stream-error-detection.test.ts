import { describe, expect, test } from "bun:test";
import { isStreamErrorResponse } from "../../src/proxy/index";

/**
 * Characterization tests for upstream stream error detection.
 *
 * Regression target: Qoder accounts were being marked exhausted (quota forced to 0)
 * when their SSE stream contained legitimate payloads with a top-level `error` field.
 * The old detection treated any `error` field as a service error.
 *
 * This test pins down which payloads ARE and ARE NOT upstream errors after the fix.
 */
describe("isStreamErrorResponse", () => {
  describe("true positives (must be detected as errors)", () => {
    test("Qoder explicit upstream_error signal", () => {
      expect(
        isStreamErrorResponse({ type: "upstream_error", error: "Qoder HTTP 403" }),
      ).toBe(true);
    });

    test("Qoder in-body 403 with statusCodeValue", () => {
      expect(
        isStreamErrorResponse({
          code: "112",
          statusCodeValue: 403,
          message: "rate limited",
        }),
      ).toBe(true);
    });

    test("Anthropic service-level error envelope", () => {
      expect(
        isStreamErrorResponse({
          type: "error",
          error: { type: "rate_limit_error", message: "overloaded" },
        }),
      ).toBe(true);
    });

    test("OpenAI service-level error (no choices/id/delta)", () => {
      expect(
        isStreamErrorResponse({
          error: {
            message: "Rate limit reached",
            type: "requests",
            code: "rate_limit_exceeded",
          },
        }),
      ).toBe(true);
    });

    test("Qoder 500 statusCodeValue", () => {
      expect(
        isStreamErrorResponse({ statusCodeValue: 500, message: "server error" }),
      ).toBe(true);
    });
  });

  describe("false positives (must NOT be detected as errors)", () => {
    test("Anthropic tool result reporting an error to the model (inside delta)", () => {
      // This is a normal streaming chunk — error is part of tool_use input
      expect(
        isStreamErrorResponse({
          type: "content_block_delta",
          index: 0,
          delta: {
            type: "input_json_delta",
            partial_json: JSON.stringify({
              name: "search",
              error: "rate limited while searching",
            }),
          },
        }),
      ).toBe(false);
    });

    test("OpenAI streaming chunk with tool_calls and error inside tool args", () => {
      // error lives inside delta.tool_calls[].function.arguments — legitimate
      expect(
        isStreamErrorResponse({
          id: "chatcmpl-abc",
          object: "chat.completion.chunk",
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      name: "exec",
                      arguments: JSON.stringify({ cmd: "x", error: "non-fatal" }),
                    },
                  },
                ],
              },
            },
          ],
        }),
      ).toBe(false);
    });

    test("OpenAI refusal message in content (error mentioned in text)", () => {
      // Refusal arrives as choices[].delta.content, NOT as top-level error
      expect(
        isStreamErrorResponse({
          id: "chatcmpl-xyz",
          choices: [
            {
              index: 0,
              delta: { content: "I cannot help with that. Error: forbidden content" },
            },
          ],
        }),
      ).toBe(false);
    });

    test("OpenAI normal streaming chunk with id and choices", () => {
      expect(
        isStreamErrorResponse({
          id: "chatcmpl-1",
          object: "chat.completion.chunk",
          created: 1700000000,
          model: "gpt-4",
          choices: [{ index: 0, delta: { content: "Hello" } }],
        }),
      ).toBe(false);
    });

    test("Anthropic content_block_start with error field inside input", () => {
      // Error field can be part of tool input JSON
      expect(
        isStreamErrorResponse({
          type: "content_block_start",
          index: 0,
          content_block: {
            type: "tool_use",
            id: "toolu_1",
            name: "bash",
            input: { command: "echo", error: "ignored" },
          },
        }),
      ).toBe(false);
    });

    test("Anthropic message_delta with stop_reason", () => {
      expect(
        isStreamErrorResponse({
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 50 },
        }),
      ).toBe(false);
    });

    test("empty object", () => {
      expect(isStreamErrorResponse({})).toBe(false);
    });

    test("non-object values", () => {
      expect(isStreamErrorResponse(null)).toBe(false);
      expect(isStreamErrorResponse(undefined)).toBe(false);
      expect(isStreamErrorResponse("error")).toBe(false);
      expect(isStreamErrorResponse(42)).toBe(false);
      expect(isStreamErrorResponse(true)).toBe(false);
    });

    test("error field is null (legit empty state)", () => {
      // Some providers emit { error: null } as a heartbeat; not a real error
      expect(
        isStreamErrorResponse({
          id: "chatcmpl-1",
          choices: [{ index: 0, delta: {} }],
          error: null,
        }),
      ).toBe(false);
    });

    test("Qoder chunk with statusCodeValue < 400 (success body)", () => {
      expect(
        isStreamErrorResponse({
          statusCodeValue: 200,
          message: "ok",
        }),
      ).toBe(false);
    });
  });
});
