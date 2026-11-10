# ถอนการติดตั้ง HOSxP Bridge: ปิดตัวที่เปิดอยู่ ลบทางลัดใน Startup และลบโฟลเดอร์ที่ติดตั้ง
Add-Type -AssemblyName System.Windows.Forms
$dir = $PSScriptRoot
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -match 'hosxp-bridge\.ps1' } |
  ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }
Remove-Item (Join-Path ([Environment]::GetFolderPath('Startup')) 'HOSxP Bridge.lnk') -Force -ErrorAction SilentlyContinue
# ตัวเฝ้าที่ bridge ลงทะเบียนไว้ (ทุก 5 นาที)
try { $svc = New-Object -ComObject Schedule.Service; $svc.Connect(); $svc.GetFolder('').DeleteTask('HOSxP Bridge Watchdog', 0) } catch {}
Start-Sleep -Milliseconds 500
Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
[void][System.Windows.Forms.MessageBox]::Show('ถอนการติดตั้ง HOSxP Bridge เรียบร้อย', 'HOSxP Bridge')
