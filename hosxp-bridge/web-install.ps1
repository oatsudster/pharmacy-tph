# One-command HOSxP Bridge install/reinstall straight from GitHub Pages (no zip, no Unblock, no Extract)
#   Win+R -> paste -> Enter:
#   powershell -ep bypass -c "$f=$env:TEMP+'\hxb.ps1';[Net.ServicePointManager]::SecurityProtocol=3072;(New-Object Net.WebClient).DownloadFile('https://oatsudster.github.io/pharmacy-tph/hosxp-bridge/web-install.ps1',$f);& $f"
#   (saved to a file first, not iex(DownloadString): Bitdefender blocks that form)
# Downloads the Windows files listed in update.json + installer/install.ps1 into %TEMP%, then runs install.ps1
# (keeps the db.json already in %LOCALAPPDATA%\HOSxPBridge; db.json is never on the web).
# Keep this file ASCII-only: it is saved without BOM and run (older copies of the page run it via iex), so the code page must not matter.
$ErrorActionPreference = 'Stop'
$base = if ($env:HXB_UPDATE_BASE) { $env:HXB_UPDATE_BASE } else { 'https://oatsudster.github.io/pharmacy-tph/hosxp-bridge/' }
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$utf8 = New-Object Text.UTF8Encoding $false
$bom = New-Object Text.UTF8Encoding $true
# 2026-11-20: one hospital PC got (403) Forbidden on the 2nd download (web filter / Bitdefender web protection).
# Try several request shapes and the Cloudflare mirror; first one that works wins.
$UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
$bases = @($base)
if (-not $env:HXB_UPDATE_BASE) { $bases += 'https://tph-pharmacy.pages.dev/hosxp-bridge/' }
function Get-Bytes($src) {
  $errs = @()
  foreach ($b in $bases) {
    foreach ($q in @(('?t=' + [DateTime]::UtcNow.Ticks), '')) {
      foreach ($ua in @($UA, '')) {
        try {
          $wc = New-Object Net.WebClient
          if ($ua) { $wc.Headers['User-Agent'] = $ua }
          return , $wc.DownloadData($b + $src + $q)
        } catch { $errs += ($b + $src + $q + ' ' + $(if ($ua) { '[UA]' } else { '[noUA]' }) + ': ' + $_.Exception.InnerException.Message + $_.Exception.Message) }
      }
    }
  }
  throw ("download failed: " + $src + "`r`n  " + ($errs -join "`r`n  "))
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
