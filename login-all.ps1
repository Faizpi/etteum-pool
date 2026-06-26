$apiKey = "f1d0971736efdd534424d1bb4fcc174d9fd28997863f6e7a"
$headers = @{
    "Authorization" = "Bearer $apiKey"
    "Content-Type" = "application/json"
}

# Get all accounts
$resp = Invoke-RestMethod -Uri "http://localhost:1930/api/accounts" -Method GET -Headers $headers
$accounts = $resp.data
Write-Host "Triggering login for $($accounts.Count) accounts..."

# Trigger login for each account
$success = 0
$failed = 0
foreach ($acc in $accounts) {
    try {
        $id = [int]$acc.id
        $result = Invoke-RestMethod -Uri "http://localhost:1930/api/accounts/$id/login" -Method POST -Headers $headers
        Write-Host "  [$id] $($acc.email) - $($result.status)"
        $success++
    } catch {
        Write-Host "  [$id] $($acc.email) - FAILED: $($_.Exception.Message)"
        $failed++
    }
}

Write-Host "`nDone: $success triggered, $failed failed"
