# ติดตั้ง HOSxP Bridge ให้ผู้ใช้ Windows คนปัจจุบัน (ไม่ต้องใช้สิทธิ์ admin)
#   1. คัดลอกไฟล์ไปที่ %LOCALAPPDATA%\HOSxPBridge
#   2. ตั้งให้เปิดเองตอน login (ทางลัดในโฟลเดอร์ Startup) — ถามว่าทุกวัน หรือเฉพาะวันพุธ-พฤหัส (วันคลินิก)
#   3. ปิดตัวเก่า (ถ้ามี) แล้วเปิดตัวใหม่ และตรวจว่าตอบได้
#   4. ตรวจ OCR ของ Windows (ใช้อ่านวันนัด) และเปิดหน้าตั้งค่า Chrome/Edge ให้กดอนุญาต
# -Target / -Quiet / -NoStartup / -Days ใช้ตอนทดสอบตัวติดตั้งเท่านั้น (-Days 'all' หรือ '3,4')
param([string]$Target = (Join-Path $env:LOCALAPPDATA 'HOSxPBridge'), [switch]$Quiet, [switch]$NoStartup, [string]$Days = '')

Add-Type -AssemblyName System.Windows.Forms
$src = $PSScriptRoot
$SITE = 'https%3A%2F%2Foatsudster.github.io'
function Msg($text, $icon = 'Information') {
  if ($Quiet) { Write-Host $text; return }
  [void][System.Windows.Forms.MessageBox]::Show($text, 'HOSxP Bridge', 'OK', $icon)
}
function BridgeState {
  try { return (Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:8765/current).Content | ConvertFrom-Json } catch { return $null }
}

try {
  # ปิดตัวที่เปิดอยู่ก่อน (ตัวที่เปิดด้วยสิทธิ์ admin จะปิดจากตรงนี้ไม่ได้ — ตรวจอีกทีด้านล่าง)
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -match 'hosxp-bridge\.ps1' } |
    ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }
  Start-Sleep -Milliseconds 500

  New-Item -ItemType Directory -Force $Target | Out-Null
  foreach ($f in 'hosxp-bridge.ps1', 'start-bridge.bat', 'uninstall.cmd', 'uninstall.ps1') {
    Copy-Item (Join-Path $src $f) $Target -Force
  }

  # วันที่ให้เปิดเองตอน login — เครื่องลงคลินิกใช้แค่พุธ-พฤหัส เครื่องห้องจ่ายยาใช้หน้าต่างยาคงเหลือทุกวัน
  if (-not $Days) {
    if ($Quiet) { $Days = 'all' }
    else {
      $ans = [System.Windows.Forms.MessageBox]::Show(
        "ให้ HOSxP Bridge เปิดเองตอนเปิดเครื่องวันไหน?`n`n" +
        "• Yes = เฉพาะวันพุธและพฤหัสบดี (เครื่องที่ใช้ลงคลินิก HT/DM)`n" +
        "• No = ทุกวัน (เครื่องห้องจ่ายยาที่ใช้หน้าต่างยาคงเหลือทุกวัน)`n`n" +
        "วันอื่นยังเปิดเองได้ โดยดับเบิลคลิก start-bridge.bat ในโฟลเดอร์ที่ติดตั้ง",
        'HOSxP Bridge', 'YesNo', 'Question')
      $Days = if ($ans -eq 'Yes') { '3,4' } else { 'all' }
    }
  }
  $daysFile = Join-Path $Target 'autostart-days.txt'
  if ($Days -eq 'all') { Remove-Item $daysFile -Force -ErrorAction SilentlyContinue }
  else { [IO.File]::WriteAllText($daysFile, $Days) }
  $daysText = if ($Days -eq 'all') { 'ทุกวัน' } else {
    ($Days -split '[^0-9]+' | Where-Object { $_ } | ForEach-Object { @('อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์')[[int]$_] }) -join ', ' }

  if (-not $NoStartup) {
    $lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'HOSxP Bridge.lnk'
    $sc = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
    $sc.TargetPath = Join-Path $Target 'start-bridge.bat'
    $sc.Arguments = 'auto'   # start-bridge.bat ตรวจวันใน autostart-days.txt ก่อนเปิด
    $sc.WorkingDirectory = $Target
    $sc.WindowStyle = 7   # ย่อหน้าต่าง
    $sc.Description = 'HOSxP Bridge — ส่ง HN/วันนัด/ใบสั่งยา ให้หน้าต่างลอยยาคงเหลือ'
    $sc.Save()
  }

  Start-Process (Join-Path $Target 'start-bridge.bat') -WorkingDirectory $Target -WindowStyle Minimized
  $state = $null
  for ($i = 0; $i -lt 30 -and -not $state; $i++) { Start-Sleep -Milliseconds 500; $state = BridgeState }

  $notes = @()
  if (-not $state) {
    $notes += '⚠️ Bridge ยังไม่ตอบ — ลองรีสตาร์ทเครื่อง ถ้ายังไม่ได้ อาจถูก IT ปิดการใช้ PowerShell ไว้'
  } elseif ($null -eq $state.PSObject.Properties['active']) {
    # ตัวเก่าที่เปิดด้วยสิทธิ์ admin ยังค้างอยู่ ตัวใหม่จึงเปิดพอร์ตไม่ได้
    $notes += '⚠️ ยังมี HOSxP Bridge ตัวเก่าเปิดอยู่ — ปิดหน้าต่าง "HOSxP Bridge" ที่ taskbar แล้วรันตัวติดตั้งนี้อีกครั้ง'
  }

  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  if (-not [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages.Count) {
    $notes += '⚠️ เครื่องนี้ไม่มี OCR ของ Windows — จะอ่านวันนัดเองไม่ได้ (HN/วิธีใช้ยายังได้) ให้ IT รันใน PowerShell (admin):' +
      "`n   Add-WindowsCapability -Online -Name `"Language.OCR~~~en-US~0.0.1.0`""
  }

  if (-not $Quiet) {
    $chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
                "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
    $edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") |
      Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($chrome) { Start-Process $chrome "chrome://settings/content/siteDetails?site=$SITE" }
    elseif ($edge) { Start-Process $edge "edge://settings/content/siteDetails?site=$SITE" }
  }

  Msg (("✅ ติดตั้ง HOSxP Bridge เรียบร้อย`n" +
    "• เปิดเองตอน login เครื่องนี้: $daysText`n" +
    "• ในหน้าตั้งค่าเบราว์เซอร์ที่เปิดขึ้นมา ให้ตั้ง `"Local network`" และ `"Apps on device`" เป็น Allow`n" +
    "• เปิดหน้าคลินิก → กด 🩺 บันทึกคลินิก (ลอย) หรือ 🪟 ยาคงเหลือ (ลอย) แล้ววางหน้าต่างลอยไว้ทางขวาสุด`n" +
    "• ถอนการติดตั้ง: $Target\uninstall.cmd") + $(if ($notes) { "`n`n" + ($notes -join "`n") } else { '' })) $(if ($notes) { 'Warning' } else { 'Information' })
} catch {
  Msg ("ติดตั้งไม่สำเร็จ:`n" + $_) 'Error'
  exit 1
}
