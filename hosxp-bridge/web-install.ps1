# HOSxP Bridge install/reinstall from https://tph-hxb.pages.dev/ (bridge files are no longer on the web app site:
# Bitdefender flagged the web app as Cloud Malware for hosting scripts + a PowerShell one-liner, 2026-11-24).
# Run by the pharmacist: download this file, right-click > Run with PowerShell.
# Downloads the Windows files listed in update.json + installer/install.ps1 into %TEMP%, then runs install.ps1
# (keeps the db.json already in %LOCALAPPDATA%\HOSxPBridge; db.json is never on the web).
# Keep this file ASCII-only: it is saved without BOM and run (older copies of the page run it via iex), so the code page must not matter.
$ErrorActionPreference = 'Stop'
$base = if ($env:HXB_UPDATE_BASE) { $env:HXB_UPDATE_BASE } else { 'https://tph-hxb.pages.dev/' }
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$utf8 = New-Object Text.UTF8Encoding $false
$bom = New-Object Text.UTF8Encoding $true
function Get-Bytes($src) {
  $wc = New-Object Net.WebClient
  try { return , $wc.DownloadData($base + $src + '?t=' + [DateTime]::UtcNow.Ticks) }
  catch { try { return , $wc.DownloadData($base + $src) } catch { throw ("download failed: " + $base + $src + ": " + $_.Exception.Message) } }
}
function Get-Text($src) {
  $s = $utf8.GetString((Get-Bytes $src)).TrimStart([char]0xFEFF)
  ($s -replace "`r`n", "`n") -replace "`n", "`r`n"
}
$stage = Join-Path $env:TEMP ('hxb-web-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $stage | Out-Null
try {
  Write-Host 'HOSxP Bridge: downloading files ...'
  $files = @((Get-Text 'update.json' | ConvertFrom-Json).files | Where-Object { -not $_.os -or $_.os -eq 'win' } | ForEach-Object { $_.src })
  $files += 'installer/install.ps1'
  foreach ($src in $files) {
    $text = Get-Text $src
    if (-not $text.Trim()) { throw "empty file on the web: $src" }
    # install.ps1 copies from its own folder by leaf name, so flatten installer/xxx -> xxx
    $dst = Join-Path $stage (Split-Path $src -Leaf)
    # PowerShell 5.1 reads BOM-less .ps1 as ANSI and breaks Thai text
    [IO.File]::WriteAllText($dst, $text, $(if ($dst -like '*.ps1') { $bom } else { $utf8 }))
    Write-Host "  $src"
  }
  [IO.File]::WriteAllText((Join-Path $stage 'uninstall.cmd'),
    "@powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"%~dp0uninstall.ps1`"`r`n", [Text.Encoding]::ASCII)
  # db.json: install.ps1 copies it only if present in the stage; the PC's existing one stays untouched
  Write-Host 'HOSxP Bridge: installing ...'
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $stage 'install.ps1')
} catch {
  Write-Host ('HOSxP Bridge install failed: ' + $_) -ForegroundColor Red
  Read-Host 'Press Enter to close'
} finally {
  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
}
