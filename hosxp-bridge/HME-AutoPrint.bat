@echo off
rem Open the rx-sticker page (home-meds tab) in its own Chrome/Edge window that prints without the print dialog
rem (--kiosk-printing: prints straight to the printer used last in this window - run with "setup" once to pick the sticker printer)
rem Separate profile so normal Chrome keeps its print dialog. First run: log in to the web app in this window.
set "URL=https://oatsudster.github.io/pharmacy-tph/rx-sticker.html#hme"
set "PROF=%LOCALAPPDATA%\TPH-AutoPrint"
set "B=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%B%" set "B=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%B%" set "B=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not exist "%B%" set "B=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
set "KIOSK=--kiosk-printing"
if /i "%~1"=="setup" set "KIOSK="
start "" "%B%" --user-data-dir="%PROF%" %KIOSK% --app="%URL%"
