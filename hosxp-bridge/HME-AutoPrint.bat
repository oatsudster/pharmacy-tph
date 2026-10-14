@echo off
rem Open the rx-sticker page (home-meds tab) in its own Chrome/Edge window that prints without the print dialog
rem (--kiosk-printing: prints without a dialog to the sticker printer set by hme-printer.ps1; "setup" shows the dialog)
rem Separate profile so normal Chrome keeps its print dialog. First run: log in to the web app in this window.
set "URL=https://oatsudster.github.io/pharmacy-tph/rx-sticker.html#hme-auto"
set "PROF=%LOCALAPPDATA%\TPH-AutoPrint"
set "B=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%B%" set "B=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%B%" set "B=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not exist "%B%" set "B=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
set "KIOSK=--kiosk-printing"
if /i "%~1"=="setup" set "KIOSK="
rem Silent printing goes to the sticker printer (Zebra/ZDesigner, or the name in %PROF%\printer.txt), not the Windows default A4 printer
if not "%~1"=="setup" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0hme-printer.ps1" -Prof "%PROF%"
start "" "%B%" --user-data-dir="%PROF%" %KIOSK% --app="%URL%"
