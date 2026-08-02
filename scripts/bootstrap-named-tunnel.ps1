$ErrorActionPreference = 'Stop'

$Root = Split-Path $PSScriptRoot -Parent
$EnvFile = Join-Path $Root '.env'
$CfDir = Join-Path $env:USERPROFILE '.cloudflared'
$CertFile = Join-Path $CfDir 'cert.pem'
$ConfigFile = Join-Path $CfDir 'config.yml'
$TunnelName = 'opensteam'
$PrimaryHost = 'opensteam.lol'
$FallbackHost = 'opensteam.gamegen.lol'
$ServiceUrl = 'http://127.0.0.1:3000'

function Find-Cloudflared {
    $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($p in @(
        "$env:ProgramFiles\cloudflared\cloudflared.exe",
        "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe"
    )) {
        if (Test-Path $p) { return $p }
    }
    throw 'cloudflared not installed'
}

function Set-EnvKey([string]$Key, [string]$Value) {
    $lines = Get-Content $EnvFile -ErrorAction Stop
    $found = $false
    $out = foreach ($line in $lines) {
        if ($line -match "^$Key=") {
            $found = $true
            "$Key=`"$Value`""
        } else { $line }
    }
    if (-not $found) { $out += "$Key=`"$Value`"" }
    Set-Content -Path $EnvFile -Value ($out -join "`n") -Encoding utf8
}

function Invoke-Cloudflared {
    param([string[]]$Args)
    $out = & $cloudflared @Args 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw ($out -join "`n")
    }
    return ($out -join "`n")
}

$cloudflared = Find-Cloudflared
New-Item -ItemType Directory -Force $CfDir | Out-Null

Write-Host '[bootstrap] Step 1: Cloudflare authorization (one browser click required)'
if (-not (Test-Path $CertFile)) {
    $login = Start-Process -FilePath $cloudflared -ArgumentList @('tunnel', 'login') -PassThru -WindowStyle Hidden
    Start-Sleep -Seconds 3
    $loginLog = Get-Content (Join-Path $CfDir '..\..') -ErrorAction SilentlyContinue
    Write-Host '[bootstrap] Complete authorization in the browser window that opened.'
    Write-Host '[bootstrap] Waiting up to 10 minutes for cert.pem ...'
    for ($i = 0; $i -lt 600; $i++) {
        if (Test-Path $CertFile) { break }
        Start-Sleep -Seconds 1
    }
    if (-not (Test-Path $CertFile)) {
        throw 'Authorization timed out. Run cloudflared tunnel login, click Authorize, then rerun this script.'
    }
    Write-Host '[bootstrap] Cloudflare authorized.'
}

Write-Host '[bootstrap] Step 2: Create tunnel'
$tunnelsJson = & $cloudflared tunnel list --output json 2>&1 | Out-String
$tunnelId = $null
try {
    $tunnels = $tunnelsJson | ConvertFrom-Json
    $existing = $tunnels | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1
    if ($existing) {
        $tunnelId = $existing.id
        Write-Host "[bootstrap] Reusing tunnel $TunnelName ($tunnelId)"
    }
} catch { }

if (-not $tunnelId) {
    $createOut = Invoke-Cloudflared @('tunnel', 'create', $TunnelName)
    if ($createOut -match '([0-9a-f-]{36})') { $tunnelId = $Matches[1] }
    if (-not $tunnelId) { throw "Could not parse tunnel id from: $createOut" }
    Write-Host "[bootstrap] Created tunnel $TunnelName ($tunnelId)"
}

Write-Host '[bootstrap] Step 3: DNS route'
$publicHost = $PrimaryHost
foreach ($hostName in @($PrimaryHost, $FallbackHost)) {
    try {
        Invoke-Cloudflared @('tunnel', 'route', 'dns', $TunnelName, $hostName) | Out-Null
        $publicHost = $hostName
        Write-Host "[bootstrap] Routed $hostName"
        break
    } catch {
        Write-Host "[bootstrap] Could not route ${hostName}: $($_.Exception.Message)"
    }
}

$publicUrl = "https://$publicHost"
Write-Host "[bootstrap] Public URL: $publicUrl"

Write-Host '[bootstrap] Step 4: Write cloudflared config'
@"
tunnel: $tunnelId
credentials-file: $CfDir\$tunnelId.json

ingress:
  - hostname: $PrimaryHost
    service: $ServiceUrl
  - hostname: $FallbackHost
    service: $ServiceUrl
  - service: http_status:404
"@ | Set-Content -Path $ConfigFile -Encoding utf8

Write-Host '[bootstrap] Step 5: Extract tunnel token'
$token = (Invoke-Cloudflared @('tunnel', 'token', $TunnelName)).Trim()
if (-not $token) { throw 'Empty tunnel token' }

Set-EnvKey 'TUNNEL_TOKEN' $token
Set-EnvKey 'NAMED_PUBLIC_URL' $publicUrl
Set-EnvKey 'NEXTAUTH_URL' $publicUrl
Set-EnvKey 'NEXT_PUBLIC_APP_URL' $publicUrl
Set-EnvKey 'PUBLIC_TUNNEL_URL' $publicUrl
Set-EnvKey 'TRUSTED_PROXY' 'cloudflare'

Push-Location $Root
node scripts/sync-named-tunnel.js $publicUrl
Pop-Location

Write-Host '[bootstrap] Step 6: Restart PM2'
pm2 restart manifest-tunnel manifest-web manifest-bot --update-env

Write-Host ''
Write-Host "Done. Public site: $publicUrl"
Write-Host "Discord OAuth redirect: $publicUrl/api/auth/callback/discord"
