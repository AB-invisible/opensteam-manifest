$ErrorActionPreference = 'Stop'

$Root = Split-Path $PSScriptRoot -Parent
$EnvFile = Join-Path $Root '.env'

Write-Host ''
Write-Host '=== OpenSteam Cloudflare Tunnel Setup ==='
Write-Host ''
Write-Host 'This uses your gamegen Cloudflare account (same as gamegen.lol).'
Write-Host 'Goal: https://opensteam.lol -> http://127.0.0.1:3000 on this PC'
Write-Host ''

$cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cloudflared) {
    $cloudflared = "$env:ProgramFiles\cloudflared\cloudflared.exe"
    if (-not (Test-Path $cloudflared)) {
        $cloudflared = "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe"
    }
}
if (-not (Test-Path $cloudflared)) {
    Write-Host 'Installing cloudflared...'
    winget install Cloudflare.cloudflared --accept-package-agreements --accept-source-agreements --silent
    $cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
}
if (-not $cloudflared) {
    throw 'cloudflared not found after install'
}

Write-Host "cloudflared: $cloudflared"
Write-Host ''
Write-Host 'In Cloudflare Zero Trust (same account as gamegen.lol):'
Write-Host '  1. https://one.dash.cloudflare.com/ -> Networks -> Tunnels'
Write-Host '  2. Create tunnel (Cloudflared) named "opensteam" OR reuse an existing tunnel'
Write-Host '  3. Public Hostname: opensteam.lol -> HTTP -> http://127.0.0.1:3000'
Write-Host '  4. Also add www.opensteam.lol if you use it'
Write-Host '  5. Copy the install token (long string after --token)'
Write-Host ''
Write-Host 'DNS: opensteam.lol must be added to Cloudflare (orange cloud).'
Write-Host '      Right now public DNS does not resolve — add the zone or register the domain first.'
Write-Host ''

$token = Read-Host 'Paste TUNNEL_TOKEN (or press Enter to skip)'
if (-not $token.Trim()) {
    Write-Host 'No token saved. Add TUNNEL_TOKEN to .env manually, then run:'
    Write-Host '  pm2 restart manifest-tunnel manifest-web manifest-bot --update-env'
    exit 0
}

function Set-EnvKey([string]$Key, [string]$Value) {
    $lines = Get-Content $EnvFile -ErrorAction Stop
    $found = $false
    $out = foreach ($line in $lines) {
        if ($line -match "^$Key=") {
            $found = $true
            "$Key=`"$Value`""
        } else {
            $line
        }
    }
    if (-not $found) { $out += "$Key=`"$Value`"" }
    Set-Content -Path $EnvFile -Value ($out -join "`n") -Encoding utf8
}

Set-EnvKey 'TUNNEL_TOKEN' $token.Trim()
Set-EnvKey 'NAMED_PUBLIC_URL' 'https://opensteam.lol'
Set-EnvKey 'NEXTAUTH_URL' 'https://opensteam.lol'
Set-EnvKey 'NEXT_PUBLIC_APP_URL' 'https://opensteam.lol'
Set-EnvKey 'PUBLIC_TUNNEL_URL' 'https://opensteam.lol'
Set-EnvKey 'TRUSTED_PROXY' 'cloudflare'

Push-Location $Root
node scripts/sync-named-tunnel.js https://opensteam.lol
Pop-Location

Write-Host ''
Write-Host 'Restarting PM2 tunnel + web + bot...'
pm2 restart manifest-tunnel manifest-web manifest-bot --update-env

Write-Host ''
Write-Host 'Done. Test from another device (not this PC hosts file):'
Write-Host '  https://opensteam.lol'
Write-Host ''
Write-Host 'Discord OAuth redirect (add in Developer Portal if missing):'
Write-Host '  https://opensteam.lol/api/auth/callback/discord'
