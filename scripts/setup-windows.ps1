$ErrorActionPreference = 'Stop'

$Root = Split-Path $PSScriptRoot -Parent
$Desktop = [Environment]::GetFolderPath('Desktop')
$BotInfo = Join-Path $Desktop 'bot info.txt'
$EnvFile = Join-Path $Root '.env'
$ExampleEnv = Join-Path $Root '.env.example'
$PgBin = 'C:\Program Files\PostgreSQL\17\bin'
$DbPassword = 'bhrhxd57'
$DbName = 'manifest-generator'

function Write-Step([string]$Message) {
    Write-Host ''
    Write-Host "== $Message"
}

function Ensure-Admin {
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator
    )
    if (-not $isAdmin) {
        throw 'Run install-everything.bat as Administrator.'
    }
}

function Parse-BotInfo {
    if (-not (Test-Path $BotInfo)) {
        Write-Host "  [--] Desktop\bot info.txt not found"
        return $null
    }

    $lines = Get-Content $BotInfo
    $info = @{}

    for ($i = 0; $i -lt $lines.Count; $i++) {
        $line = $lines[$i].Trim()
        switch -Regex ($line) {
            '^Application ID$|^Client ID$' {
                for ($j = $i + 1; $j -lt [Math]::Min($i + 6, $lines.Count); $j++) {
                    $candidate = $lines[$j].Trim()
                    if ($candidate -match '^\d{17,20}$') {
                        $info.CLIENT_ID = $candidate
                        break
                    }
                }
            }
            '^guild id\s*$' {
                for ($j = $i + 1; $j -lt [Math]::Min($i + 4, $lines.Count); $j++) {
                    $candidate = $lines[$j].Trim()
                    if ($candidate -match '^\d{17,20}$') {
                        $info.GUILD_ID = $candidate
                        break
                    }
                }
            }
        }
    }

    if ($info.CLIENT_ID) {
        Write-Host "  [OK] OpenSteam activation bot reference from Desktop\bot info.txt"
        return $info
    }

    return $null
}

function Update-EnvValue {
    param([string]$Path, [string]$Key, [string]$Value)
    if (-not (Test-Path $Path)) { return }
    $escaped = $Value -replace '\\', '\\\\' -replace '"', '\"'
    $lines = Get-Content $Path
    $found = $false
    $out = foreach ($line in $lines) {
        if ($line -match "^$([regex]::Escape($Key))=") {
            $found = $true
            "$Key=`"$escaped`""
        } else {
            $line
        }
    }
    if (-not $found) {
        $out += "$Key=`"$escaped`""
    }
    Set-Content -Path $Path -Value $out -Encoding UTF8
}

function Ensure-PostgresDatabase {
    if (-not (Test-Path "$PgBin\psql.exe")) {
        throw "PostgreSQL not found at $PgBin"
    }

    $env:PGPASSWORD = $DbPassword
    $exists = & "$PgBin\psql.exe" -U postgres -h 127.0.0.1 -p 5432 -tAc "SELECT 1 FROM pg_database WHERE datname = '$DbName'" 2>$null
    if ($exists -ne '1') {
        & "$PgBin\psql.exe" -U postgres -h 127.0.0.1 -p 5432 -c "CREATE DATABASE $DbName;" | Out-Null
        Write-Host "  [OK] Created database $DbName"
    } else {
        Write-Host "  [OK] Database $DbName already exists"
    }
}

Ensure-Admin

Write-Step 'OpenSteam Manifest Platform — fresh Windows setup'
Write-Host '  Does NOT modify C:\Users\ayoub\Desktop\denuvo (activation bot stack)'

Write-Step 'Reading OpenSteam activation bot reference (denuvo uses this separately)'
$bot = Parse-BotInfo
if (-not $bot) {
    throw 'Desktop\bot info.txt is required.'
}

Write-Step 'Creating .env'
if (-not (Test-Path $EnvFile)) {
    if (-not (Test-Path $ExampleEnv)) {
        throw '.env.example not found'
    }
    Copy-Item $ExampleEnv $EnvFile
    Write-Host '  [OK] Created .env from .env.example'
}

$storagePath = Join-Path $Root 'storage'
if (-not (Test-Path $storagePath)) {
    New-Item -ItemType Directory -Path $storagePath -Force | Out-Null
}

Update-EnvValue -Path $EnvFile -Key 'DATABASE_URL' -Value "postgresql://postgres:${DbPassword}@127.0.0.1:5432/${DbName}?schema=public"
Update-EnvValue -Path $EnvFile -Key 'DISCORD_GUILD_ID' -Value $bot.GUILD_ID
Update-EnvValue -Path $EnvFile -Key 'OPENSTEAM_ACTIVATION_CLIENT_ID' -Value $bot.CLIENT_ID
Update-EnvValue -Path $EnvFile -Key 'OPENSTEAM_ACTIVATION_GUILD_ID' -Value $bot.GUILD_ID
Update-EnvValue -Path $EnvFile -Key 'BUCKET_TYPE' -Value 'windows'
Update-EnvValue -Path $EnvFile -Key 'STORAGE_PATH' -Value ($storagePath -replace '\\', '/')
Update-EnvValue -Path $EnvFile -Key 'NODE_ENV' -Value 'production'
Update-EnvValue -Path $EnvFile -Key 'BRAND_NAME' -Value 'OpenSteam'
Update-EnvValue -Path $EnvFile -Key 'BRAND_TAGLINE' -Value 'OpenSteam Manifests'
Update-EnvValue -Path $EnvFile -Key 'NEXTAUTH_URL' -Value 'http://127.0.0.1:3000'
Update-EnvValue -Path $EnvFile -Key 'NEXT_PUBLIC_APP_URL' -Value 'http://127.0.0.1:3000'

Write-Step 'Rebrand GameGen -> OpenSteam in source'
node (Join-Path $PSScriptRoot 'rebrand-to-opensteam.js')

Write-Step 'Dual-bot split + rotate shared-repo secrets'
node (Join-Path $PSScriptRoot 'configure-dual-bot.js')
node (Join-Path $PSScriptRoot 'rotate-secrets.js')

Write-Step 'Ensuring PostgreSQL database'
Ensure-PostgresDatabase

Write-Step 'Installing npm dependencies'
Push-Location $Root
npm install
if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }

Write-Step 'Applying Prisma schema'
npx prisma generate
if ($LASTEXITCODE -ne 0) { throw 'prisma generate failed' }
npx prisma db push
if ($LASTEXITCODE -ne 0) { throw 'prisma db push failed' }

Write-Step 'Seeding Discord credentials in database'
node (Join-Path $PSScriptRoot 'seed-discord-config.js')
if ($LASTEXITCODE -ne 0) { throw 'seed-discord-config failed' }

Write-Step 'Registering Discord slash commands (manifest bot app)'
node scripts/register-commands.js
if ($LASTEXITCODE -ne 0) {
    Write-Host '  [WARN] register-commands failed — invite the manifest bot first:'
    node (Join-Path $PSScriptRoot 'print-bot-invite.js')
}

Write-Step 'Building Next.js app (this may take several minutes)'
npm run build
if ($LASTEXITCODE -ne 0) { throw 'npm run build failed' }
Pop-Location

Write-Step 'Installing PM2'
npm install -g pm2
if ($LASTEXITCODE -ne 0) { throw 'pm2 install failed' }

Write-Step 'Starting opensteam-web + opensteam-manifest-bot'
Push-Location $Root
pm2 delete manifest-web,manifest-bot -s 2>$null
pm2 start ecosystem.config.js
pm2 save
Pop-Location

Write-Host ''
Write-Host 'Done. Two bots can run together:'
Write-Host '  1) denuvo/OpenSteam activation bot -> Desktop\bot info.txt (denuvo-bot service)'
Write-Host '  2) OpenSteam manifest platform bot -> separate Discord app in .env DISCORD_BOT_TOKEN'
Write-Host ''
Write-Host '  Web:  http://127.0.0.1:3000'
Write-Host '  PM2:  pm2 status / pm2 logs'
Write-Host ''
Write-Host 'Security: repo-default secrets were rotated. Regenerate manifest bot token in Discord Developer Portal'
Write-Host 'if you previously used the public backup bot from the repo.'
Write-Host ''
node (Join-Path $PSScriptRoot 'print-bot-invite.js')
