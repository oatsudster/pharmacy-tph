' HOSxP Bridge watchdog - Task Scheduler "HOSxP Bridge Watchdog" runs this every 5 minutes (wscript, no window).
' If no hosxp-bridge.ps1 process is running, start it hidden. Registered by hosxp-bridge.ps1 itself at startup,
' so PCs get it through self-update (no reinstall). stop-bridge.bat writes stopped.flag = do not restart
' until start-bridge.bat runs again. ASCII only (wscript reads .vbs as ANSI).
Option Explicit
Dim fso, dir, wmi, procs
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
If fso.FileExists(dir & "\stopped.flag") Then WScript.Quit 0
If Not fso.FileExists(dir & "\hosxp-bridge.ps1") Then WScript.Quit 0
Set wmi = GetObject("winmgmts:{impersonationLevel=impersonate}!\\.\root\cimv2")
Set procs = wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE Name='powershell.exe' AND CommandLine LIKE '%hosxp-bridge.ps1%'")
If procs.Count > 0 Then WScript.Quit 0
CreateObject("WScript.Shell").Run "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\hosxp-bridge.ps1""", 0, False
