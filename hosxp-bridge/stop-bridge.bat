@echo off
rem Stop HOSxP Bridge (it runs hidden, so there is no window to close). start-bridge.bat starts it again.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match 'hosxp-bridge[.]ps1' } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }"
rem stopped.flag = the watchdog task (bridge-watchdog.vbs) does not restart it until the bridge is started again
echo stopped> "%~dp0stopped.flag"
