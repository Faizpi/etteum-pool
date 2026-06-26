@echo off
cd /d "C:\Users\Faiz\etteum-pool"
bun scripts/production.ts --skip-build > "C:\Users\Faiz\etteum-pool\.etteum.log" 2> "C:\Users\Faiz\etteum-pool\.etteum.err"
