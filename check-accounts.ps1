$apiKey = "f1d0971736efdd534424d1bb4fcc174d9fd28997863f6e7a"
$headers = @{
    "Authorization" = "Bearer $apiKey"
    "Content-Type" = "application/json"
}

# Check accounts
$accounts = Invoke-RestMethod -Uri "http://localhost:1930/api/accounts" -Method GET -Headers $headers
Write-Host "Type: $($accounts.GetType())"
Write-Host "Count: $($accounts.Count)"
$accounts | ConvertTo-Json -Depth 2 | Out-File C:\Users\Faiz\etteum-pool\accounts-dump.json
Write-Host "Dumped to accounts-dump.json"

# Try delete endpoint with all IDs
$ids = $accounts | ForEach-Object { $_.id }
Write-Host "IDs: $($ids -join ',')"
if ($ids.Count -gt 0) {
    $deleteBody = @{ ids = $ids } | ConvertTo-Json
    $deleteResult = Invoke-RestMethod -Uri "http://localhost:1930/api/accounts/bulk-delete" -Method POST -Headers $headers -Body $deleteBody
    Write-Host "Delete result: $($deleteResult | ConvertTo-Json -Depth 2)"
}
