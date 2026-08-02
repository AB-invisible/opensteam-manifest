$ErrorActionPreference = 'Stop'

$Root = Split-Path $PSScriptRoot -Parent
$Data = Join-Path $env:USERPROFILE 'Desktop\opensteam-web-data'
$UrlFile = Join-Path $Data 'public-url.txt'
$LogFile = Join-Path $Data 'tunnel.log'

New-Item -ItemType Directory -Force $Data | Out-Null

$cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cloudflared) {
    $local = "$env:ProgramFiles\cloudflared\cloudflared.exe"
    if (Test-Path $local) { $cloudflared = $local }
}
if (-not $cloudflared) {
    $local = "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe"
    if (Test-Path $local) { $cloudflared = $local }
}
if (-not $cloudflared) {
    throw 'cloudflared is not installed. Run: winget install Cloudflare.cloudflared'
}

function Sync-Env([string]$Url) {
    if (-not $Url) { return }
    Set-Content -Path $UrlFile -Value $Url.Trim() -Encoding ascii
    Push-Location $Root
    node scripts/sync-oauth-urls.js $Url.Trim() | Write-Host
    Pop-Location
    Write-Host "[opensteam-tunnel] Public HTTPS URL: $Url"
    Write-Host "[opensteam-tunnel] Restart web: pm2 restart manifest-web --update-env"
}

Write-Host "[opensteam-tunnel] Starting -> http://127.0.0.1:3000"

if (Test-Path $LogFile) { Remove-Item $LogFile -Force }

$proc = Start-Process -FilePath $cloudflared `
    -ArgumentList @('tunnel', '--url', 'http://127.0.0.1:3000', '--no-autoupdate') `
    -RedirectStandardError $LogFile `
    -PassThru `
    -WindowStyle Hidden

for ($i = 0; $i -lt 120; $i++) {
    if ($proc.HasExited) { break }
    if (Test-Path $LogFile) {
        $content = Get-Content $LogFile -Raw -ErrorAction SilentlyContinue
        if ($content -match '(https://[a-z0-9-]+\.trycloudflare\.com)') {
            Sync-Env $Matches[1]
            break
        }
    }
    Start-Sleep -Seconds 1
}

while (-not $proc.HasExited) { Start-Sleep -Seconds 5 }
