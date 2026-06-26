$accounts = @()
$raw = @"
quqatafok@gsuitee.id|password
tewelinob@gsuitee.id|password
dexanewum@gsuitee.id|password
xihiqexov@gsuitee.id|password
kexiluwux@gsuitee.id|password
tequjizaj@gsuitee.id|password
tizijixux@gsuitee.id|password
zucozetex@gsuitee.id|password
lucosenox@gsuitee.id|password
lejibukad@gsuitee.id|password
nagofuwad@gsuitee.id|password
wunojatug@gsuitee.id|password
vivixuzos@gsuitee.id|password
tonadeciv@gsuitee.id|password
hajunutac@gsuitee.id|password
pazapisoc@gsuitee.id|password
fudulaxuk@gsuitee.id|password
damigubex@gsuitee.id|password
kimavanes@gsuitee.id|password
bizuvepim@gsuitee.id|password
picumarij@gsuitee.id|password
xugirinuk@gsuitee.id|password
qokuximov@gsuitee.id|password
lomowuhul@gsuitee.id|password
wexisuxij@gsuitee.id|password
segeparaw@gsuitee.id|password
vawubamaw@gsuitee.id|password
humoleqiv@gsuitee.id|password
zipisujih@gsuitee.id|password
kibidijej@gsuitee.id|password
xufecumex@gsuitee.id|password
lexifaqiw@gsuitee.id|password
melalobeq@gsuitee.id|password
gagofuver@gsuitee.id|password
xemewiher@gsuitee.id|password
jakatakep@gsuitee.id|password
xafijojun@gsuitee.id|password
cuquvepeh@gsuitee.id|password
refacozix@gsuitee.id|password
cariqehuf@gsuitee.id|password
fupudaqiv@gsuitee.id|password
rizecomow@gsuitee.id|password
tufocipid@gsuitee.id|password
safaxutup@gsuitee.id|password
doruzerad@gsuitee.id|password
howesebaq@gsuitee.id|password
bomipuxet@gsuitee.id|password
cenuxexag@gsuitee.id|password
ruwejanec@gsuitee.id|password
keluwamuk@gsuitee.id|password
lapicibor@gsuitee.id|password
qonepowak@gsuitee.id|password
wuxexiliw@gsuitee.id|password
maqujikis@gsuitee.id|password
luciwobej@gsuitee.id|password
rilahuvus@gsuitee.id|password
majifepim@gsuitee.id|password
qitaxawiz@gsuitee.id|password
vuwigiviw@gsuitee.id|password
henugaxuh@gsuitee.id|password
gocelavof@gsuitee.id|password
nehabumoj@gsuitee.id|password
wisikugec@gsuitee.id|password
quzocoruz@gsuitee.id|password
xitufuxot@gsuitee.id|password
deliqobiz@gsuitee.id|password
dewonuqiq@gsuitee.id|password
ziceqijah@gsuitee.id|password
jisaletog@gsuitee.id|password
sivucireq@gsuitee.id|password
pafajoxul@gsuitee.id|password
nimenalif@gsuitee.id|password
xexizitas@gsuitee.id|password
fowegusoj@gsuitee.id|password
vaqedaven@gsuitee.id|password
detaqusiq@gsuitee.id|password
qupujovec@gsuitee.id|password
jofebilug@gsuitee.id|password
goqojiguz@gsuitee.id|password
vovecemov@gsuitee.id|password
xebucitig@gsuitee.id|password
mixikenit@gsuitee.id|password
qewuxusiv@gsuitee.id|password
zipuqedax@gsuitee.id|password
zexomafiq@gsuitee.id|password
gocarezox@gsuitee.id|password
wuhifoxoj@gsuitee.id|password
nazalacuv@gsuitee.id|password
veviwamev@gsuitee.id|password
guzabamuj@gsuitee.id|password
wewixidiw@gsuitee.id|password
dehiwudit@gsuitee.id|password
hujigixad@gsuitee.id|password
gaxigatud@gsuitee.id|password
gobobidoz@gsuitee.id|password
nicizinup@gsuitee.id|password
gonatapal@gsuitee.id|password
lonuropuw@gsuitee.id|password
dixoququv@gsuitee.id|password
"@ -split "`n"

foreach ($line in $raw) {
    $parts = $line.Trim() -split "\|"
    if ($parts.Length -eq 2) {
        $accounts += @{
            provider = "kiro"
            email = $parts[0]
            password = $parts[1]
        }
    }
}

$body = @{ accounts = $accounts } | ConvertTo-Json -Depth 3
$headers = @{
    "Authorization" = "Bearer f1d0971736efdd534424d1bb4fcc174d9fd28997863f6e7a"
    "Content-Type" = "application/json"
}

$result = Invoke-RestMethod -Uri "http://localhost:1930/api/accounts/bulk" -Method POST -Headers $headers -Body $body
$result | ConvertTo-Json -Depth 3
