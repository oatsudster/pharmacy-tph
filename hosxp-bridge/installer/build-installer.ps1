# สร้างตัวติดตั้ง hosxp-bridge\HOSxPBridge-Installer.exe ด้วย IExpress (มากับ Windows อยู่แล้ว)
#   powershell -ExecutionPolicy Bypass -File hosxp-bridge\installer\build-installer.ps1
# exe ที่ได้จะแตกไฟล์ลง temp แล้วรัน install.ps1 (ติดตั้งให้ผู้ใช้คนปัจจุบัน ไม่ต้องใช้ admin)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$bridgeDir = Split-Path $here
$out = Join-Path $bridgeDir 'HOSxPBridge-Installer.exe'
$stage = Join-Path $env:TEMP ('hxb-build-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $stage | Out-Null

# PowerShell 5.1 อ่าน .ps1 ที่ไม่มี BOM เป็น ANSI ภาษาไทยจะเพี้ยน — เขียนเป็น UTF-8 มี BOM ทุกไฟล์
$bom = New-Object System.Text.UTF8Encoding $true
foreach ($f in @((Join-Path $bridgeDir 'hosxp-bridge.ps1'), (Join-Path $here 'install.ps1'), (Join-Path $here 'uninstall.ps1'))) {
  [IO.File]::WriteAllText((Join-Path $stage (Split-Path $f -Leaf)), [IO.File]::ReadAllText($f, [Text.Encoding]::UTF8), $bom)
}
Copy-Item (Join-Path $bridgeDir 'start-bridge.bat') $stage
[IO.File]::WriteAllText((Join-Path $stage 'install.cmd'),
  "@powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"%~dp0install.ps1`"`r`n", [Text.Encoding]::ASCII)
[IO.File]::WriteAllText((Join-Path $stage 'uninstall.cmd'),
  "@powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"%~dp0uninstall.ps1`"`r`n", [Text.Encoding]::ASCII)

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
