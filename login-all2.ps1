$headers = @{
    "Authorization" = "Bearer f1d0971736efdd534424d1bb4fcc174d9fd28997863f6e7a"
    "Content-Type" = "application/json"
}
$body = '{"concurrency": 2}'
$r = Invoke-RestMethod -Uri "http://localhost:1930/api/auth/login-all" -Method POST -Headers $headers -Body $body
Write-Host "$($r.message) (count: $($r.count))"
