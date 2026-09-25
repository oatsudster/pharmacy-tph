@echo off
rem Start HOSxP Bridge minimized: lets the floating windows read HN, name, appointment days and orders from HOSxP
rem "auto" = launched by the Startup shortcut at login: only run on the weekdays listed in autostart-days.txt
rem (0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat). No file = every day. Double-clicking this file always starts it.
if /i "%~1"=="auto" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$f = Join-Path '%~dp0' 'autostart-days.txt'; if (Test-Path $f) { $d = (Get-Content $f -Raw) -split '[^0-9]+' | Where-Object { $_ }; if ($d -notcontains [string][int](Get-Date).DayOfWeek) { exit 1 } }; exit 0"
  if errorlevel 1 exit /b 0
)
start "HOSxP Bridge" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0hosxp-bridge.ps1"
