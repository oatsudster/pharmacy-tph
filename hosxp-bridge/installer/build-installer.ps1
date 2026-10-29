# สร้างตัวติดตั้ง hosxp-bridge\HOSxPBridge-Installer.exe ด้วย IExpress (มากับ Windows อยู่แล้ว)
#   powershell -ExecutionPolicy Bypass -File hosxp-bridge\installer\build-installer.ps1
# exe ที่ได้จะแตกไฟล์ลง temp แล้วรัน install.ps1 (ติดตั้งให้ผู้ใช้คนปัจจุบัน ไม่ต้องใช้ admin)
# -Zip: สร้าง output\HOSxPBridge-noexe.zip แทน (เครื่อง รพ. ที่บล็อก exe) พร้อม db.json จาก -DbJson
#   (ค่าเริ่มต้น %LOCALAPPDATA%\HOSxPBridge\db.json) — zip มีรหัสฐานข้อมูล ห้าม commit/อัปโหลด แจกในเครือข่าย รพ. เท่านั้น
#   exe ที่ commit ไว้ใน repo ไม่มี db.json เสมอ
# -Mac: สร้าง output\HOSxPBridge-mac.zip (MacBook) พร้อม db.json และ PowerShell 7 สำหรับ Apple Silicon
#   (เก็บ tarball ไว้ที่ output\cache ดาวน์โหลดครั้งเดียว) — zip ทำด้วย Python เพื่อให้ไฟล์ .command/.sh มีสิทธิ์รัน (chmod 755)
#   ติดตั้งครั้งเดียว หลังจากนั้นหน้าเว็บอัปเดต bridge ให้เองเหมือน Windows
param([switch]$Zip, [switch]$Mac, [string]$DbJson = (Join-Path $env:LOCALAPPDATA 'HOSxPBridge\db.json'))
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$bridgeDir = Split-Path $here

if ($Mac) {
  $pwshVer = '7.4.6'; $tgz = "powershell-$pwshVer-osx-arm64.tar.gz"
  $cache = Join-Path (Split-Path $bridgeDir) 'output\cache'
  New-Item -ItemType Directory -Force $cache | Out-Null
  if (-not (Test-Path (Join-Path $cache $tgz))) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing "https://github.com/PowerShell/PowerShell/releases/download/v$pwshVer/$tgz" -OutFile (Join-Path $cache $tgz)
  }
  $zipOut = Join-Path (Split-Path $bridgeDir) 'output\HOSxPBridge-mac.zip'
  if (-not (Test-Path $DbJson)) { Write-Warning "ไม่พบ $DbJson — zip จะไม่มี db.json" }
  $py = @'
import sys, zipfile, os
out, bridge, db, tgz = sys.argv[1:5]
def norm(path):
    b = open(path, 'rb').read()
    if b.startswith(b'\xef\xbb\xbf') and not path.endswith('.ps1'): b = b[3:]
    return b.replace(b'\r\n', b'\n')
files = [('Install HOSxP Bridge.command', 'mac/install.command'), ('hosxp-bridge.ps1', 'hosxp-bridge.ps1'), ('hxdb.cs', 'hxdb.cs'),
         ('update.json', 'update.json'), ('start-bridge.sh', 'mac/start-bridge.sh'), ('README.txt', 'mac/README.txt'),
         ('mac/restart-bridge.command', 'mac/restart-bridge.command'), ('mac/stop-bridge.command', 'mac/stop-bridge.command'),
         ('mac/uninstall-bridge.command', 'mac/uninstall-bridge.command')]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    def add(name, data, mode):
        zi = zipfile.ZipInfo('HOSxPBridge-mac/' + name, (2026, 1, 1, 0, 0, 0))
        zi.create_system = 3; zi.external_attr = (0o100000 | mode) << 16; zi.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(zi, data)
    for name, src in files:
        add(name, norm(os.path.join(bridge, src)), 0o755 if name.endswith(('.command', '.sh')) else 0o644)
    if os.path.exists(db): add('db.json', open(db, 'rb').read(), 0o600)
    add(os.path.basename(tgz), open(tgz, 'rb').read(), 0o644)
'@
  $pyFile = Join-Path $env:TEMP 'hxb-mac-zip.py'
  [IO.File]::WriteAllText($pyFile, $py)
  & python $pyFile $zipOut $bridgeDir $DbJson (Join-Path $cache $tgz)
  if ($LASTEXITCODE) { throw 'สร้าง zip ไม่สำเร็จ' }
  Remove-Item $pyFile -Force
  Write-Host "สร้างแล้ว: $zipOut ($([math]::Round((Get-Item $zipOut).Length / 1MB)) MB)"
  return
}
$out = Join-Path $bridgeDir 'HOSxPBridge-Installer.exe'
$stage = Join-Path $env:TEMP ('hxb-build-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $stage | Out-Null

# PowerShell 5.1 อ่าน .ps1 ที่ไม่มี BOM เป็น ANSI ภาษาไทยจะเพี้ยน — เขียนเป็น UTF-8 มี BOM ทุกไฟล์
$bom = New-Object System.Text.UTF8Encoding $true
foreach ($f in @((Join-Path $bridgeDir 'hosxp-bridge.ps1'), (Join-Path $bridgeDir 'hme-printer.ps1'), (Join-Path $here 'install.ps1'), (Join-Path $here 'uninstall.ps1'))) {
  [IO.File]::WriteAllText((Join-Path $stage (Split-Path $f -Leaf)), [IO.File]::ReadAllText($f, [Text.Encoding]::UTF8), $bom)
}
Copy-Item (Join-Path $bridgeDir 'start-bridge.bat') $stage
Copy-Item (Join-Path $bridgeDir 'stop-bridge.bat') $stage
Copy-Item (Join-Path $bridgeDir 'hxdb.cs') $stage
Copy-Item (Join-Path $bridgeDir 'update.json') $stage
Copy-Item (Join-Path $bridgeDir 'HME-AutoPrint.bat') $stage
Copy-Item (Join-Path $bridgeDir 'HME-AutoPrint-setup.bat') $stage
[IO.File]::WriteAllText((Join-Path $stage 'install.cmd'),
  "@powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"%~dp0install.ps1`"`r`n", [Text.Encoding]::ASCII)
[IO.File]::WriteAllText((Join-Path $stage 'uninstall.cmd'),
  "@powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"%~dp0uninstall.ps1`"`r`n", [Text.Encoding]::ASCII)

if ($Zip) {
  Copy-Item (Join-Path $here 'README.txt') $stage
  if (Test-Path $DbJson) { Copy-Item $DbJson (Join-Path $stage 'db.json') } else { Write-Warning "ไม่พบ $DbJson — zip จะไม่มี db.json (ใช้ OCR)" }
  $zipOut = Join-Path (Split-Path $bridgeDir) 'output\HOSxPBridge-noexe.zip'
  New-Item -ItemType Directory -Force (Split-Path $zipOut) | Out-Null
  Remove-Item $zipOut -Force -ErrorAction SilentlyContinue
  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zipOut
  Remove-Item $stage -Recurse -Force
  Write-Host "สร้างแล้ว: $zipOut"
  return
}

$files = Get-ChildItem $stage -File | Select-Object -ExpandProperty Name
$sed = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=1
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=%InstallPrompt%
DisplayLicense=%DisplayLicense%
FinishMessage=%FinishMessage%
TargetName=%TargetName%
FriendlyName=%FriendlyName%
AppLaunched=%AppLaunched%
PostInstallCmd=%PostInstallCmd%
AdminQuietInstCmd=%AdminQuietInstCmd%
UserQuietInstCmd=%UserQuietInstCmd%
SourceFiles=SourceFiles
[Strings]
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=$out
FriendlyName=HOSxP Bridge
AppLaunched=cmd /c install.cmd
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
$(($files | ForEach-Object -Begin { $i = 0 } -Process { "FILE$i=`"$_`""; $i++ }) -join "`r`n")
[SourceFiles]
SourceFiles0=$stage\
[SourceFiles0]
$(($files | ForEach-Object -Begin { $i = 0 } -Process { "%FILE$i%="; $i++ }) -join "`r`n")
"@
$sedPath = Join-Path $stage 'build.sed'
[IO.File]::WriteAllText($sedPath, $sed, [Text.Encoding]::Default)
Remove-Item $out -Force -ErrorAction SilentlyContinue
Start-Process "$env:WINDIR\System32\iexpress.exe" -ArgumentList '/N', '/Q', $sedPath -Wait
Remove-Item $stage -Recurse -Force
if (-not (Test-Path $out)) { throw 'IExpress ไม่ได้สร้างไฟล์ exe' }
Write-Host "สร้างแล้ว: $out ($([math]::Round((Get-Item $out).Length / 1KB)) KB)"
