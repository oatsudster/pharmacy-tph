# HOSxP Bridge — ส่ง HN + จำนวนวันถึงนัด ของผู้ป่วยที่เปิดหน้าจ่ายยาอยู่ใน HOSxP XE ให้หน้าเว็บ
#
# อ่านจากหน้าจอ HOSxP เท่านั้น (Windows UI Automation + OCR) ไม่แตะฐานข้อมูล ไม่กด/แก้อะไรใน HOSxP
# เปิด http://127.0.0.1:8765/current ให้เฉพาะเครื่องนี้ และรับเฉพาะหน้าเว็บของเรา (ALLOWED_ORIGINS)
#
# ตำแหน่งข้อมูลในหน้าจ่ายยา (THOSxPDiepensingDispenseEntryFrame) ของ HOSxP XE 4:
#   HN / ชื่อ — TcxDBTextEdit ที่อยู่ทางขวาของป้าย "HN" / "ชื่อ"
#   วันนัด   — THTMListBox ในกล่อง "ข้อมูลการนัดหมาย" แสดงเป็น "1.[119 วัน] 22 มกราคม 2570 ..."
#              list นี้วาดข้อความเอง อ่านผ่าน API ไม่ได้ จึงจับภาพแล้ว OCR เอาตัวเลขในวงเล็บ [..]

$PORT = 8765
$ALLOWED_ORIGINS = @('https://oatsudster.github.io', 'null')   # 'null' = เปิดไฟล์ html จากเครื่องตรงๆ

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing, System.Runtime.WindowsRuntime
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class HxWin {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
}
"@
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]

$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
function ClassCond($cls) { New-Object System.Windows.Automation.PropertyCondition($AE::ClassNameProperty, $cls) }

$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
# ไม่มี OCR ภาษาไทยก็ไม่เป็นไร เราต้องการแค่ตัวเลขในวงเล็บ ใช้ภาษาอังกฤษได้
$ocr = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $ocr) { $ocr = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('en-US')) }

$state = [ordered]@{ ok = $false; hn = ''; name = ''; apptDays = $null; ts = 0 }
$cache = @{ hnEdit = $null; nameEdit = $null; apptList = $null }
$lastHn = ''; $nextOcr = [DateTime]::MinValue

function FieldRightOf($frame, $labelText) {
  $label = $frame.FindAll($TS::Descendants, (ClassCond 'TcxLabel')) | Where-Object { $_.Current.Name -eq $labelText } | Select-Object -First 1
  if (-not $label) { return $null }
  $lr = $label.Current.BoundingRectangle
  $frame.FindAll($TS::Descendants, (ClassCond 'TcxDBTextEdit')) |
    Where-Object { $r = $_.Current.BoundingRectangle; [Math]::Abs($r.Y - $lr.Y) -lt 12 -and $r.X -gt $lr.X } |
    Sort-Object { $_.Current.BoundingRectangle.X } | Select-Object -First 1
}

function FindDispenseScreen {
  $cache.hnEdit = $null; $cache.nameEdit = $null; $cache.apptList = $null
  $proc = Get-Process HOSxPXE4 -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $proc) { return }
  $main = $AE::RootElement.FindFirst($TS::Children, (New-Object System.Windows.Automation.PropertyCondition($AE::ProcessIdProperty, [int]$proc.Id)))
  if (-not $main) { return }
  $frame = $main.FindFirst($TS::Descendants, (ClassCond 'THOSxPDiepensingDispenseEntryFrame'))
  if (-not $frame) { return }
  $cache.hnEdit = FieldRightOf $frame 'HN'
  $cache.nameEdit = FieldRightOf $frame 'ชื่อ'
  $cache.apptList = $frame.FindFirst($TS::Descendants, (ClassCond 'THTMListBox'))
}

function ReadApptDays($list) {
  if (-not $list -or -not $ocr) { return $null }
  $r = $list.Current.BoundingRectangle
  $w = [int]$r.Width; $h = [int][Math]::Min($r.Height, 80)   # บรรทัดแรกๆ พอ นัดแรกอยู่บนสุด
  if ($w -le 0 -or $h -le 0) { return $null }
  $bmp = New-Object System.Drawing.Bitmap $w, ([int]$r.Height)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $g.GetHdc()
  # PrintWindow วาดจาก control เองจึงได้ภาพแม้มีหน้าต่างอื่น (เช่นหน้าต่างลอย) บังอยู่
  $okPrint = [HxWin]::PrintWindow([IntPtr]$list.Current.NativeWindowHandle, $hdc, 0)
  $g.ReleaseHdc($hdc)
  if (-not $okPrint) { $g.CopyFromScreen([int]$r.X, [int]$r.Y, 0, 0, $bmp.Size) }
  $g.Dispose()
  # ขยาย 2 เท่า OCR อ่านตัวเลขเล็กๆ ได้แม่นขึ้น
  $big = New-Object System.Drawing.Bitmap ($w * 2), ($h * 2)
  $g2 = [System.Drawing.Graphics]::FromImage($big)
  $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g2.DrawImage($bmp, (New-Object System.Drawing.Rectangle 0, 0, ($w * 2), ($h * 2)), (New-Object System.Drawing.Rectangle 0, 0, $w, $h), [System.Drawing.GraphicsUnit]::Pixel)
  $g2.Dispose(); $bmp.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $big.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $big.Dispose()
  $ms.Position = 0
  $ras = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($ms)
  $dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ras)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $sb = Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $res = Await ($ocr.RecognizeAsync($sb)) ([Windows.Media.Ocr.OcrResult])
  $ms.Dispose()
  foreach ($line in $res.Lines) {
    if ($line.Text -match '\[\s*(\d{1,4})') { return [int]$Matches[1] }
  }
  return $null
}

function UpdateState {
  $hn = ''; $name = ''
  try {
    if (-not $cache.hnEdit) { FindDispenseScreen }
    if ($cache.hnEdit) {
      $hn = $cache.hnEdit.Current.Name.Trim()
      if ($cache.nameEdit) { $name = $cache.nameEdit.Current.Name.Trim() }
    }
  } catch {
    # หน้าจ่ายยาถูกปิด/สร้างใหม่ — element เดิมใช้ไม่ได้แล้ว ค้นหาใหม่รอบหน้า
    $cache.hnEdit = $null
  }
  if (-not $cache.hnEdit) { FindDispenseScreen; if ($cache.hnEdit) { try { $hn = $cache.hnEdit.Current.Name.Trim() } catch {} } }

  if ($hn -ne $script:lastHn) { $script:lastHn = $hn; $state.apptDays = $null; $script:nextOcr = [DateTime]::MinValue }
  # OCR วันนัดตอนเปลี่ยนคนไข้ และซ้ำทุก 5 วินาที เผื่อข้อมูลนัดโหลดขึ้นมาทีหลัง
  if ($hn -and (Get-Date) -ge $script:nextOcr) {
    try { $d = ReadApptDays $cache.apptList; if ($d -ne $null) { $state.apptDays = $d } } catch {}
    $script:nextOcr = (Get-Date).AddSeconds(5)
  }
  $state.ok = [bool]$cache.hnEdit
  $state.hn = $hn; $state.name = $name
  $state.ts = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
}

function Respond($client) {
  $stream = $client.GetStream()
  $stream.ReadTimeout = 1000
  $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII)
  $first = $reader.ReadLine(); $origin = ''
  while (($line = $reader.ReadLine())) { if ($line -match '^Origin:\s*(.+)$') { $origin = $Matches[1].Trim() } }
  $method = ($first -split ' ')[0]; $path = ($first -split ' ')[1]
  $cors = ''
  if ($ALLOWED_ORIGINS -contains $origin) {
    $cors = "Access-Control-Allow-Origin: $origin`r`nAccess-Control-Allow-Private-Network: true`r`nAccess-Control-Allow-Methods: GET`r`nVary: Origin`r`n"
  }
  if ($method -eq 'OPTIONS') { $status = '204 No Content'; $body = '' }
  elseif ($path -like '/current*') { $status = '200 OK'; $body = ($state | ConvertTo-Json -Compress) }
  else { $status = '404 Not Found'; $body = '' }
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
  $head = "HTTP/1.1 $status`r`nContent-Type: application/json; charset=utf-8`r`nCache-Control: no-store`r`n$cors" + "Content-Length: $($bytes.Length)`r`nConnection: close`r`n`r`n"
  $hb = [System.Text.Encoding]::ASCII.GetBytes($head)
  $stream.Write($hb, 0, $hb.Length); $stream.Write($bytes, 0, $bytes.Length)
  $client.Close()
}

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $PORT)
try { $listener.Start() } catch { Write-Host "เปิดพอร์ต $PORT ไม่ได้ — อาจมี HOSxP Bridge เปิดอยู่แล้ว"; exit 1 }
Write-Host "HOSxP Bridge ทำงานแล้ว ที่ http://127.0.0.1:$PORT/current  (ปิดหน้าต่างนี้เพื่อหยุด)"
$nextPoll = [DateTime]::MinValue
while ($true) {
  if ((Get-Date) -ge $nextPoll) { UpdateState; $nextPoll = (Get-Date).AddSeconds(1) }
  while ($listener.Pending()) { try { Respond $listener.AcceptTcpClient() } catch {} }
  Start-Sleep -Milliseconds 100
}
