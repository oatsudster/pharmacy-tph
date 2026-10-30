# One-command HOSxP Bridge install/reinstall straight from GitHub Pages (no zip, no Unblock, no Extract)
#   Win+R -> paste -> Enter:
#   powershell -ep bypass -c "[Net.ServicePointManager]::SecurityProtocol=3072;iex(New-Object Net.WebClient).DownloadString('https://oatsudster.github.io/pharmacy-tph/hosxp-bridge/web-install.ps1')"
# Downloads the Windows files listed in update.json + installer/install.ps1 into %TEMP%, then runs install.ps1
# (keeps the db.json already in %LOCALAPPDATA%\HOSxPBridge; db.json is never on the web).
# Keep this file ASCII-only: it is run via iex from a downloaded string, so the code page must not matter.
$ErrorActionPreference = 'Stop'
$base = if ($env:HXB_UPDATE_BASE) { $env:HXB_UPDATE_BASE } else { 'https://oatsudster.github.io/pharmacy-tph/hosxp-bridge/' }
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$wc = New-Object Net.WebClient
$wc.Headers['Cache-Control'] = 'no-cache'
$utf8 = New-Object Text.UTF8Encoding $false
$bom = New-Object Text.UTF8Encoding $true
function Get-Text($src) {
  $s = $utf8.GetString($wc.DownloadData($base + $src + '?t=' + [DateTime]::UtcNow.Ticks)).TrimStart([char]0xFEFF)
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
