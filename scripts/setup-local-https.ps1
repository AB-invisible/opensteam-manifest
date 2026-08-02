# Trusted local HTTPS for opensteam.lol (removes browser "Not secure" on your PC).
# Run PowerShell as Administrator for port 443 proxy + mkcert -install.

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$CertDir = Join-Path $Root 'certs'
$Domain = 'opensteam.lol'

New-Item -ItemType Directory -Force $CertDir | Out-Null

function Find-Mkcert {
  $cmd = Get-Command mkcert -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $local = Join-Path $env:LOCALAPPDATA 'mkcert\mkcert.exe'
  if (Test-Path $local) { return $local }
  return $null
}

$mkcert = Find-Mkcert
if (-not $mkcert) {
  Write-Host '[setup-local-https] Installing mkcert via winget...'
  winget install -e --id FiloSottile.mkcert --accept-package-agreements --accept-source-agreements
  $mkcert = Find-Mkcert
}
if (-not $mkcert) {
  throw 'mkcert not found. Install from https://github.com/FiloSottile/mkcert/releases then re-run this script.'
}

Write-Host "[setup-local-https] Using mkcert: $mkcert"
& $mkcert -install

Push-Location $CertDir
& $mkcert -cert-file "$CertDir\$Domain.pem" -key-file "$CertDir\$Domain-key.pem" $Domain localhost 127.0.0.1 ::1
Pop-Location

Write-Host '[setup-local-https] Certificates written to certs/'

# Port 443 -> HTTPS proxy (3443) and keep 80 -> Next.js (3000) as fallback
try {
  netsh interface portproxy delete v4tov4 listenport=443 listenaddress=127.0.0.1 2>$null | Out-Null
  netsh interface portproxy add v4tov4 listenport=443 listenaddress=127.0.0.1 connectport=3443 connectaddress=127.0.0.1
  netsh interface portproxy delete v4tov4 listenport=80 listenaddress=127.0.0.1 2>$null | Out-Null
  netsh interface portproxy add v4tov4 listenport=80 listenaddress=127.0.0.1 connectport=3000 connectaddress=127.0.0.1
  Write-Host '[ok] Port proxy: https://opensteam.lol:443 -> 127.0.0.1:3443'
  Write-Host '[ok] Port proxy: http://opensteam.lol:80 -> 127.0.0.1:3000'
} catch {
  Write-Host "[!] Could not configure port 443 (run as Administrator): $_"
}

Push-Location $Root
node scripts/sync-oauth-urls.js "https://$Domain"
Pop-Location

Write-Host @"

Done. Restart stack:
  pm2 restart manifest-web manifest-https --update-env

Then open: https://opensteam.lol
(Add Discord OAuth redirect: https://opensteam.lol/api/auth/callback/discord)

"@
