# ตั้งเครื่องพิมพ์สติกเกอร์ให้หน้าต่างพิมพ์ยากลับบ้านอัตโนมัติ (HME-AutoPrint.bat เรียกก่อนเปิด Chrome)
# --kiosk-printing พิมพ์ไปเครื่องที่จำไว้ใน profile (printing.print_preview_sticky_settings) ถ้าไม่มีใช้ default ของ Windows (มักเป็น HP A4)
# เลือกเครื่องจาก %LOCALAPPDATA%\TPH-AutoPrint\printer.txt (ใส่ชื่อเครื่องเองได้) ไม่งั้นหาเครื่อง Zebra/ZDesigner
# แก้เฉพาะสตริง appState ใน Preferences (ConvertFrom-Json ของ PowerShell 5.1 อ่านไฟล์ Chrome ทั้งไฟล์ไม่ได้เสมอ)
param([string]$Prof = "$env:LOCALAPPDATA\TPH-AutoPrint")
$ErrorActionPreference = 'Stop'
$want = $null
$txt = Join-Path $Prof 'printer.txt'
if (Test-Path $txt) { $want = "$(Get-Content $txt -Encoding UTF8 | Select-Object -First 1)".Trim() }
if (-not $want) {
  $want = Get-CimInstance Win32_Printer | ForEach-Object { $_.Name } |
    Where-Object { $_ -match 'ZDesigner|Zebra|GT800|GK420|ZD2|ZD4|TSC|Xprinter|sticker|label' } | Select-Object -First 1
}
if (-not $want) { Write-Host "No sticker printer found - put the printer name in $txt"; exit 1 }
$pref = Join-Path $Prof 'Default\Preferences'
if (-not (Test-Path $pref)) { Write-Host 'Run HME-AutoPrint-setup.bat once first'; exit 1 }
# Chrome เขียน Preferences ทับตอนปิด — แก้ได้เฉพาะตอนหน้าต่างนี้ปิดอยู่
$running = Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" | Where-Object { $_.CommandLine -like "*$Prof*" }
if ($running) { exit 0 }

$app = [ordered]@{
  version = 2
  recentDestinations = @([ordered]@{ id = $want; origin = 'local'; account = ''; displayName = $want; extensionId = ''; extensionName = ''; icon = '' })
  marginsType = 1          # ไม่มีขอบ
  scaling = '100'; scalingType = 0; scalingTypePdf = 0
  isHeaderFooterEnabled = $false; isCssBackgroundEnabled = $true
}
$appJson = ConvertTo-Json $app -Compress -Depth 5
$appLit = ConvertTo-Json $appJson -Compress          # เป็น JSON string literal อีกชั้น

$raw = [IO.File]::ReadAllText($pref, [Text.Encoding]::UTF8)
$re = [regex]'"appState"\s*:\s*"(?:[^"\\]|\\.)*"'
$m = $re.Match($raw)
if ($m.Success) {
  $cur = ConvertFrom-Json ('{' + $m.Value + '}')
  $old = ConvertFrom-Json $cur.appState
  if ($old.recentDestinations -and @($old.recentDestinations)[0].id -eq $want -and $old.marginsType -eq 1) { exit 0 }   # ตั้งไว้แล้ว
  $new = $raw.Substring(0, $m.Index) + '"appState":' + $appLit + $raw.Substring($m.Index + $m.Length)
} elseif ($raw -match '"print_preview_sticky_settings"\s*:\s*\{') {
  $sep = if ($raw -match '"print_preview_sticky_settings"\s*:\s*\{\s*\}') { '' } else { ',' }
  $new = ([regex]'"print_preview_sticky_settings"\s*:\s*\{').Replace($raw, ('"print_preview_sticky_settings":{"appState":' + $appLit.Replace('$', '$$') + $sep), 1)
} elseif ($raw -match '"printing"\s*:\s*\{') {
  $sep = if ($raw -match '"printing"\s*:\s*\{\s*\}') { '' } else { ',' }
  $new = ([regex]'"printing"\s*:\s*\{').Replace($raw, ('"printing":{"print_preview_sticky_settings":{"appState":' + $appLit.Replace('$', '$$') + '}' + $sep), 1)
} else {
  $new = '{"printing":{"print_preview_sticky_settings":{"appState":' + $appLit + '}},' + $raw.TrimStart().Substring(1)
}
ConvertFrom-Json $new | Out-Null                        # ตรวจว่ายังเป็น JSON ที่ถูกต้องก่อนเขียน
Copy-Item $pref "$pref.bak" -Force
[IO.File]::WriteAllText($pref, $new, (New-Object Text.UTF8Encoding $false))
Write-Host "HME auto-print printer set to: $want"
