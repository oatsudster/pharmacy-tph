# HOSxP Bridge — ส่งข้อมูลผู้ป่วยที่เปิดหน้าจ่ายยาอยู่ใน HOSxP XE ให้หน้าต่างลอยยาคงเหลือ (clinic.html)
#
# อ่านจากหน้าจอ HOSxP เท่านั้น (Windows UI Automation + จับภาพ) ไม่แตะฐานข้อมูล ไม่กด/แก้อะไรใน HOSxP
# เปิดให้เฉพาะเครื่องนี้ (127.0.0.1) และรับเฉพาะหน้าเว็บของเรา (ALLOWED_ORIGINS):
#   /current  — JSON { ok, hn, name, apptDays, gridVer, gridCut, covered, ts }
#   /grid.png — ภาพตารางใบสั่งยาล่าสุด หน้าเว็บเอาไป OCR ภาษาไทยเองด้วย Tesseract (Windows OCR ไม่มีภาษาไทย)
#
# ตำแหน่งข้อมูลในหน้าจ่ายยา (THOSxPDiepensingDispenseEntryFrame) ของ HOSxP XE 4:
#   HN / ชื่อ     — TcxDBTextEdit ที่อยู่ทางขวาของป้าย "HN" / "ชื่อ"
#   วันนัด        — THTMListBox ในกล่อง "ข้อมูลการนัดหมาย" แสดงเป็น "1.[119 วัน] 22 มกราคม 2570 ..."
#                   วาดข้อความเอง อ่านผ่าน API ไม่ได้ จึงจับภาพแล้ว OCR (อังกฤษพอ) เอาตัวเลขในวงเล็บ [..]
#   ใบสั่งยา       — TcxGridSite ใน THOSxPMedicationOrderFrame (DevExpress grid อ่านผ่าน API ไม่ได้เช่นกัน)
# HOSxP ไม่ตอบ PrintWindow จึงต้องจับภาพจากจอจริง — ถ้ามีหน้าต่างอื่นบังอยู่ จะไม่จับส่วนที่ถูกบัง

$PORT = 8765
$ALLOWED_ORIGINS = @('https://oatsudster.github.io', 'null')   # 'null' = เปิดไฟล์ html จากเครื่องตรงๆ

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing, System.Runtime.WindowsRuntime
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class HxWin {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  // จุดบนจอนี้เป็นของโปรแกรม pid หรือไม่ (ไม่ถูกหน้าต่างอื่นบัง)
  public static bool OwnedBy(int x, int y, uint pid) {
    POINT p; p.X = x; p.Y = y;
    IntPtr h = WindowFromPoint(p);
    if (h == IntPtr.Zero) return false;
    uint owner; GetWindowThreadProcessId(GetAncestor(h, 2), out owner);
    return owner == pid;
  }
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
# วันนัดต้องการแค่ตัวเลขในวงเล็บ ใช้ OCR ภาษาอังกฤษของ Windows ได้
$ocr = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $ocr) { $ocr = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('en-US')) }
$md5 = [System.Security.Cryptography.MD5]::Create()

$state = [ordered]@{ ok = $false; hn = ''; name = ''; apptDays = $null; gridVer = 0; gridCut = $false; covered = $false; ts = 0 }
$cache = @{ pid = 0; hnEdit = $null; nameEdit = $null; apptList = $null; grid = $null }
$gridPng = $null; $gridHash = ''
$lastHn = ''; $nextAppt = [DateTime]::MinValue; $nextGrid = [DateTime]::MinValue

function FieldRightOf($frame, $labelText) {
  $label = $frame.FindAll($TS::Descendants, (ClassCond 'TcxLabel')) | Where-Object { $_.Current.Name -eq $labelText } | Select-Object -First 1
  if (-not $label) { return $null }
  $lr = $label.Current.BoundingRectangle
  $frame.FindAll($TS::Descendants, (ClassCond 'TcxDBTextEdit')) |
    Where-Object { $r = $_.Current.BoundingRectangle; [Math]::Abs($r.Y - $lr.Y) -lt 12 -and $r.X -gt $lr.X } |
    Sort-Object { $_.Current.BoundingRectangle.X } | Select-Object -First 1
}

function FindDispenseScreen {
  $cache.hnEdit = $null; $cache.nameEdit = $null; $cache.apptList = $null; $cache.grid = $null
  $proc = Get-Process HOSxPXE4 -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $proc) { return }
  $cache.pid = $proc.Id
  $main = $AE::RootElement.FindFirst($TS::Children, (New-Object System.Windows.Automation.PropertyCondition($AE::ProcessIdProperty, [int]$proc.Id)))
  if (-not $main) { return }
  $frame = $main.FindFirst($TS::Descendants, (ClassCond 'THOSxPDiepensingDispenseEntryFrame'))
  if (-not $frame) { return }
  $cache.hnEdit = FieldRightOf $frame 'HN'
  $cache.nameEdit = FieldRightOf $frame 'ชื่อ'
  $cache.apptList = $frame.FindFirst($TS::Descendants, (ClassCond 'THTMListBox'))
  $order = $frame.FindFirst($TS::Descendants, (ClassCond 'THOSxPMedicationOrderFrame'))
  if ($order) { $cache.grid = $order.FindFirst($TS::Descendants, (ClassCond 'TcxGridSite')) }
}

# ความกว้างจากขอบซ้ายของ rect ที่มองเห็นจริง (ไม่ถูกหน้าต่างอื่น เช่นหน้าต่างลอย บัง) — สุ่มตรวจเป็นจุดๆ
function VisibleWidth($r) {
  $pid0 = [uint32]$cache.pid
  $ys = @([int]($r.Y + 4), [int]($r.Y + $r.Height / 2), [int]($r.Y + $r.Height - 4))
  for ($x = [int]$r.X + 4; $x -lt $r.X + $r.Width; $x += 30) {
    foreach ($y in $ys) { if (-not [HxWin]::OwnedBy($x, $y, $pid0)) { return [int]($x - $r.X - 4) } }
  }
  return [int]$r.Width
}

function CaptureScreen($x, $y, $w, $h) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($x, $y, 0, 0, $bmp.Size); $g.Dispose()
  return $bmp
}

function ReadApptDays {
  $list = $cache.apptList
  if (-not $list -or -not $ocr) { return $null }
  $r = $list.Current.BoundingRectangle
  $w = [int]$r.Width; $h = [int][Math]::Min($r.Height, 30)   # บรรทัดแรกพอ นัดที่ใกล้สุดอยู่บนสุด
  if ($w -le 0 -or $h -le 0) { return $null }
  $vis = VisibleWidth (New-Object System.Windows.Rect $r.X, $r.Y, $w, $h)
  if ($vis -lt 250) { $state.covered = $true; return $null }   # "1.[119 วัน] 22 ..." อยู่ต้นบรรทัด เห็นแค่ช่วงแรกก็พอ
  $bmp = CaptureScreen ([int]$r.X) ([int]$r.Y) $vis $h
  # ขยาย 2 เท่า OCR อ่านตัวเลขเล็กๆ ได้แม่นขึ้น
  $big = New-Object System.Drawing.Bitmap ($vis * 2), ($h * 2)
  $g2 = [System.Drawing.Graphics]::FromImage($big)
  $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g2.DrawImage($bmp, 0, 0, $vis * 2, $h * 2); $g2.Dispose(); $bmp.Dispose()
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

# จับภาพตารางใบสั่งยา เปลี่ยนเลข gridVer เมื่อภาพเปลี่ยน หน้าเว็บจะได้ OCR ใหม่เฉพาะตอนจำเป็น
function CaptureGrid {
  $grid = $cache.grid
  if (-not $grid) { return }
  $r = $grid.Current.BoundingRectangle
  if ($r.Width -le 0 -or $r.Height -le 0) { return }
  $vis = VisibleWidth $r
  $state.gridCut = $vis -lt $r.Width
  if ($vis -lt 300) { $state.covered = $true; return }
  $bmp = CaptureScreen ([int]$r.X) ([int]$r.Y) $vis ([int]$r.Height)
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
  $bytes = $ms.ToArray(); $ms.Dispose()
  $hash = [BitConverter]::ToString($md5.ComputeHash($bytes))
  if ($hash -ne $script:gridHash) { $script:gridHash = $hash; $script:gridPng = $bytes; $state.gridVer++ }
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
    # หน้าจ่ายยาถูกปิด/สร้างใหม่ — element เดิมใช้ไม่ได้แล้ว ค้นหาใหม่
    FindDispenseScreen
    if ($cache.hnEdit) { try { $hn = $cache.hnEdit.Current.Name.Trim() } catch {} }
  }

  if ($hn -ne $script:lastHn) {
    $script:lastHn = $hn; $state.apptDays = $null
    $script:gridPng = $null; $script:gridHash = ''; $state.gridVer++
    $script:nextAppt = [DateTime]::MinValue; $script:nextGrid = [DateTime]::MinValue
  }
  if ($hn) {
    $state.covered = $false
    # วันนัดอ่านซ้ำทุก 5 วินาที ตารางยาทุก 2 วินาที เผื่อข้อมูลโหลดขึ้นมาทีหลัง หรือเพิ่งเลื่อนหน้าต่างที่บังออก
    if ((Get-Date) -ge $script:nextAppt) {
      try { $d = ReadApptDays; if ($d -ne $null) { $state.apptDays = $d } } catch {}
      $script:nextAppt = (Get-Date).AddSeconds(5)
    }
    if ((Get-Date) -ge $script:nextGrid) {
      try { CaptureGrid } catch {}
      $script:nextGrid = (Get-Date).AddSeconds(2)
    }
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
  $type = 'application/json; charset=utf-8'; $bytes = [byte[]]@()
  if ($method -eq 'OPTIONS') { $status = '204 No Content' }
  elseif ($path -like '/current*') { $status = '200 OK'; $bytes = [System.Text.Encoding]::UTF8.GetBytes(($state | ConvertTo-Json -Compress)) }
  elseif ($path -like '/grid.png*' -and $script:gridPng) { $status = '200 OK'; $type = 'image/png'; $bytes = $script:gridPng }
  else { $status = '404 Not Found' }
  $head = "HTTP/1.1 $status`r`nContent-Type: $type`r`nCache-Control: no-store`r`n$cors" + "Content-Length: $($bytes.Length)`r`nConnection: close`r`n`r`n"
  $hb = [System.Text.Encoding]::ASCII.GetBytes($head)
  $stream.Write($hb, 0, $hb.Length)
  if ($bytes.Length) { $stream.Write($bytes, 0, $bytes.Length) }
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
