<#
    OpenSteam Database - interactive PostgreSQL backup & restore utility.

    Usage
    -----
    powershell -ExecutionPolicy Bypass -File .\backup-db.ps1
#>

[CmdletBinding()]
param(
    [string] $Action = ''
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
try { $host.UI.RawUI.WindowTitle = "OpenSteam DB Utility" } catch { }

$script:Interactive = [string]::IsNullOrEmpty($Action)

# -- Console primitives -------------------------------------------------------

function Write-Color {
    param(
        [string] $Text,
        [ConsoleColor] $Color = 'White',
        [switch] $NoNewline
    )
    Write-Host $Text -ForegroundColor $Color -NoNewline:$NoNewline
}

function Write-Step($msg) { Write-Color "   -> $msg" Cyan }
function Write-Ok  ($msg) { Write-Color "   OK $msg" Green }
function Write-Warn($msg) { Write-Color "   !  $msg" Yellow }
function Write-Fail($msg) { Write-Color "   X  $msg" Red }

function Pause-Menu {
    if (-not $script:Interactive) { return }
    Write-Host ""
    Write-Color "    Press ENTER to return to the menu..." DarkGray
    [void](Read-Host)
}

# -- Dotenv loader ------------------------------------------------------------

function Load-DotEnv {
    $envPath = Join-Path $PSScriptRoot ".env"
    if (Test-Path $envPath) {
        Get-Content $envPath | ForEach-Object {
            $line = $_.Trim()
            if ($line -and -not $line.StartsWith("#")) {
                if ($line -match '^([\w.-]+)\s*=\s*(.*)$') {
                    $key = $Matches[1]
                    $val = $Matches[2].Trim()
                    if ($val.StartsWith('"') -and $val.EndsWith('"')) { $val = $val.Substring(1, $val.Length - 2) }
                    elseif ($val.StartsWith("'") -and $val.EndsWith("'")) { $val = $val.Substring(1, $val.Length - 2) }
                    [System.Environment]::SetEnvironmentVariable($key, $val)
                }
            }
        }
    }
}

# -- PostgreSQL Tool Locator --------------------------------------------------

function Get-PostgreSqlToolPath {
    param([string]$toolName)
    $path = Get-Command $toolName -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
    if ($path) { return $path }

    $commonDirs = @(
        "C:\Program Files\PostgreSQL\*\bin",
        "C:\Program Files (x86)\PostgreSQL\*\bin"
    )
    foreach ($pattern in $commonDirs) {
        $matched = Resolve-Path $pattern -ErrorAction SilentlyContinue
        if ($matched) {
            foreach ($dir in $matched) {
                $candidate = Join-Path $dir.Path "$toolName.exe"
                if (Test-Path $candidate) { return $candidate }
            }
        }
    }
    return $null
}

# -- Database URL Parser ------------------------------------------------------

function Parse-DatabaseUrl {
    param([string]$url)
    if (-not $url) { return $null }
    try {
        $uri = [System.Uri]$url
        $hostName = $uri.Host
        $port = if ($uri.Port -ne -1) { $uri.Port } else { 5432 }
        $dbName = $uri.AbsolutePath.TrimStart('/')
        $user = if ($uri.UserInfo) { $uri.UserInfo.Split(':')[0] } else { "" }
        return [PSCustomObject]@{
            Host     = $hostName
            Port     = $port
            Database = $dbName
            User     = $user
            Success  = $true
        }
    } catch {
        # Regex fallback
        if ($url -match '@([^:/]+)(:(\d+))?/([^?#]*)') {
            $hostName = $Matches[1]
            $port     = if ($Matches[3]) { [int]$Matches[3] } else { 5432 }
            $dbName   = $Matches[4]
            return [PSCustomObject]@{
                Host     = $hostName
                Port     = $port
                Database = $dbName
                User     = ""
                Success  = $true
            }
        }
    }
    return [PSCustomObject]@{ Success = $false }
}

# -- Cryptography Helpers (AES-256 Native Stream Processing) ------------------

function Encrypt-BackupFile {
    param(
        [string]$InPath,
        [string]$Password
    )
    $OutPath = $InPath + ".enc"
    
    # Generate 16 bytes random salt
    $salt = New-Object Byte[] 16
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($salt)
    
    # Derive Key and IV using PBKDF2 (10,000 iterations)
    $pbkdf2 = New-Object System.Security.Cryptography.Rfc2898DeriveBytes($Password, $salt, 10000)
    $key = $pbkdf2.GetBytes(32) # 256 bits key
    $iv = $pbkdf2.GetBytes(16)  # 128 bits IV
    
    $aes = [System.Security.Cryptography.Aes]::Create()
    $aes.Key = $key
    $aes.IV = $iv
    
    $inFileStream = New-Object System.IO.FileStream($InPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read)
    $outFileStream = New-Object System.IO.FileStream($OutPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
    
    # Write salt and IV to the output file header
    $outFileStream.Write($salt, 0, $salt.Length)
    $outFileStream.Write($iv, 0, $iv.Length)
    
    $encryptor = $aes.CreateEncryptor()
    $cryptoStream = New-Object System.Security.Cryptography.CryptoStream($outFileStream, $encryptor, [System.Security.Cryptography.CryptoStreamMode]::Write)
    
    $buffer = New-Object Byte[] 4096
    while (($bytesRead = $inFileStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
        $cryptoStream.Write($buffer, 0, $bytesRead)
    }
    
    $cryptoStream.FlushFinalBlock()
    $cryptoStream.Close()
    $inFileStream.Close()
    $outFileStream.Close()
    
    $aes.Dispose()
    $pbkdf2.Dispose()
    
    return $OutPath
}

function Decrypt-BackupFile {
    param(
        [string]$InPath,
        [string]$Password,
        [string]$OutPath
    )
    
    $inFileStream = New-Object System.IO.FileStream($InPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read)
    
    # Read salt and IV from header
    $salt = New-Object Byte[] 16
    $iv = New-Object Byte[] 16
    
    if ($inFileStream.Read($salt, 0, 16) -ne 16 -or $inFileStream.Read($iv, 0, 16) -ne 16) {
        $inFileStream.Close()
        throw "Invalid or corrupted encrypted backup file."
    }
    
    # Derive Key
    $pbkdf2 = New-Object System.Security.Cryptography.Rfc2898DeriveBytes($Password, $salt, 10000)
    $key = $pbkdf2.GetBytes(32)
    
    $aes = [System.Security.Cryptography.Aes]::Create()
    $aes.Key = $key
    $aes.IV = $iv
    
    $outFileStream = New-Object System.IO.FileStream($OutPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
    
    $decryptor = $aes.CreateDecryptor()
    $cryptoStream = New-Object System.Security.Cryptography.CryptoStream($inFileStream, $decryptor, [System.Security.Cryptography.CryptoStreamMode]::Read)
    
    try {
        $buffer = New-Object Byte[] 4096
        while (($bytesRead = $cryptoStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
            $outFileStream.Write($buffer, 0, $bytesRead)
        }
    } catch {
        $outFileStream.Close()
        $cryptoStream.Close()
        $inFileStream.Close()
        $aes.Dispose()
        $pbkdf2.Dispose()
        if (Test-Path $OutPath) { Remove-Item $OutPath -Force }
        throw "Decryption failed. Ensure the password is correct."
    }
    
    $outFileStream.Close()
    $cryptoStream.Close()
    $inFileStream.Close()
    $aes.Dispose()
    $pbkdf2.Dispose()
}

# -- Banner & Menu ------------------------------------------------------------

function Write-Banner {
    Clear-Host
    Write-Host ""
    Write-Color "   +------------------------------------------------------------------+" Magenta
    Write-Color "   |                                                                  |" Magenta
    Write-Color "   |   " Magenta -NoNewline
    Write-Color "G A M E G E N   D A T A B A S E   U T I L I T Y" Magenta -NoNewline
    Write-Color "            |" Magenta
    Write-Color "   |                                                                  |" Magenta
    Write-Color "   +------------------------------------------------------------------+" Magenta
    Write-Host ""

    $dbUrl = [System.Environment]::GetEnvironmentVariable("DATABASE_URL")
    $safeUrl = "None configured (.env missing or invalid)"
    if ($dbUrl) {
        $safeUrl = $dbUrl -replace '(?<=:\/\/)[^:]+:[^@]+@', '***:***@'
    }

    Write-Color "    Target DB   " DarkGray -NoNewline; Write-Color $safeUrl White

    $pgDump = Get-PostgreSqlToolPath "pg_dump"
    Write-Color "    pg_dump     " DarkGray -NoNewline
    if ($pgDump) { Write-Color "Found ($pgDump)" Green } else { Write-Color "NOT FOUND (Will seek on execution)" Yellow }

    $pgRestore = Get-PostgreSqlToolPath "pg_restore"
    Write-Color "    pg_restore  " DarkGray -NoNewline
    if ($pgRestore) { Write-Color "Found ($pgRestore)" Green } else { Write-Color "NOT FOUND" Yellow }

    $psql = Get-PostgreSqlToolPath "psql"
    Write-Color "    psql        " DarkGray -NoNewline
    if ($psql) { Write-Color "Found ($psql)" Green } else { Write-Color "NOT FOUND" Yellow }

    Write-Host ""
    Write-Color "   --------------------------------------------------------------------" DarkMagenta
    Write-Color "    COMMANDS" White
    Write-Color "   --------------------------------------------------------------------" DarkMagenta
    Write-Host ""
}

function Write-Menu {
    Write-Color "    [1]" Magenta -NoNewline; Write-Color "  Backup Database  " White -NoNewline; Write-Color "(Download live schema and data)" DarkGray
    Write-Color "    [2]" Magenta -NoNewline; Write-Color "  Restore Database " White -NoNewline; Write-Color "(Upload/restore database from dump)" DarkGray
    Write-Color "    [3]" Magenta -NoNewline; Write-Color "  Verify Connection" White -NoNewline; Write-Color "(Test database connectivity)" DarkGray
    Write-Color "    [4]" Magenta -NoNewline; Write-Color "  Decrypt Backup   " White -NoNewline; Write-Color "(Decrypt password-protected backups)" DarkGray
    Write-Color "    [Q]" DarkGray -NoNewline; Write-Color "  Quit" DarkGray
    Write-Host ""
    Write-Color "   --------------------------------------------------------------------" DarkMagenta
    Write-Host ""
}

# -- Backup Implementation ----------------------------------------------------

function Invoke-Backup {
    $dbUrl = [System.Environment]::GetEnvironmentVariable("DATABASE_URL")
    if (-not $dbUrl) {
        Write-Fail "DATABASE_URL not found. Verify your .env file exists in $PSScriptRoot."
        Pause-Menu; return
    }

    $pgDump = Get-PostgreSqlToolPath "pg_dump"
    if (-not $pgDump) {
        Write-Fail "Could not locate 'pg_dump' utility."
        Write-Color "    Please ensure PostgreSQL command-line tools are installed." DarkGray
        Write-Color "    Download: https://www.postgresql.org/download/windows/" DarkGray
        Pause-Menu; return
    }

    $backupDir = Join-Path $PSScriptRoot "backups"
    if (-not (Test-Path $backupDir)) {
        New-Item -Path $backupDir -ItemType Directory -Force | Out-Null
    }

    # Format Prompt
    $formatChoice = "1"
    if ($script:Interactive) {
        Write-Banner
        Write-Color "    Choose Backup Format:" White
        Write-Color "   --------------------------------------------------------------------" DarkMagenta
        Write-Color "    [1]" Magenta -NoNewline; Write-Color "  Compressed Binary (.dump)  " White -NoNewline; Write-Color "- Best for pg_restore / disasters" DarkGray
        Write-Color "    [2]" Magenta -NoNewline; Write-Color "  Plain-Text SQL (.sql)      " White -NoNewline; Write-Color "- Human-readable, open with DBeaver/VSCode" DarkGray
        Write-Color "    [Q]" DarkGray -NoNewline; Write-Color "  Cancel and return to menu" DarkGray
        Write-Host ""
        Write-Color "   --------------------------------------------------------------------" DarkMagenta
        Write-Color "    > Choose option (Default is 1): " White -NoNewline
        
        $formatChoice = Read-Host
        if ($formatChoice -match '^(q|quit|exit)$') { return }
        if ([string]::IsNullOrWhiteSpace($formatChoice)) { $formatChoice = "1" }
    }

    $ext = ".dump"
    $dumpFormat = "c" # custom compressed
    if ($formatChoice -eq "2") {
        $ext = ".sql"
        $dumpFormat = "p" # plain-text SQL
    }

    $timestamp  = Get-Date -Format "yyyyMMdd_HHmmss"
    $backupFile = Join-Path $backupDir "db-backup-$timestamp$ext"
    $latestFile = Join-Path $backupDir "db-backup-latest$ext"

    Write-Step "Creating database backup..."
    Write-Color "    Format:      $(if ($formatChoice -eq '2') { 'Plain-Text SQL (.sql)' } else { 'Compressed Binary (.dump)' })" DarkGray
    Write-Color "    Destination: $backupFile" DarkGray
    Write-Host ""

    try {
        $env:PGPASSWORD = $null
        # Temporarily suppress stderr display from pg_dump
        $prevEAP = $ErrorActionPreference
        $ErrorActionPreference = 'SilentlyContinue'
        
        & $pgDump --dbname=$dbUrl -F $dumpFormat -b -v -f $backupFile 2>&1 | ForEach-Object { "$_" } | Out-Host
        
        $ErrorActionPreference = $prevEAP

        if ($LASTEXITCODE -eq 0 -and (Test-Path $backupFile)) {
            Copy-Item -Path $backupFile -Destination $latestFile -Force
            $sizeMb = [Math]::Round((Get-Item $backupFile).Length / 1MB, 3)
            Write-Host ""
            Write-Ok "Backup completed successfully!"
            Write-Color "    Backup File: $(Split-Path $backupFile -Leaf)" DarkGray
            Write-Color "    File Size:   $sizeMb MB" DarkGray
            Write-Color "    Latest File: $(Split-Path $latestFile -Leaf)" DarkGray
            
            # Application Recommendations Printout
            Write-Host ""
            Write-Color "    [APPLICATION RECOMMENDATIONS FOR VIEWING]" Yellow
            if ($formatChoice -eq "2") {
                Write-Color "    - Text Editors:  Open this .sql file in VS Code, Notepad++, or Sublime Text." DarkGray
                Write-Color "                     You can read/search all raw INSERT and CREATE statements." DarkGray
                Write-Color "    - Database GUIs: Drag and drop this .sql file into DBeaver (highly recommended," DarkGray
                Write-Color "                     free, open-source) or pgAdmin to run queries or view structure." DarkGray
            } else {
                Write-Color "    - Database GUIs: Import this .dump file visually in DBeaver (free, open-source)" DarkGray
                Write-Color "                     using PostgreSQL client tools, or restore via this script." DarkGray
            }

            # Encryption Prompt
            if ($script:Interactive) {
                Write-Host ""
                Write-Color "    [PASSWORD PROTECTION]" Yellow
                Write-Color "    Would you like to password-protect (encrypt) this backup file now? (y/n): " White -NoNewline
                $encryptChoice = Read-Host
                if ($encryptChoice -match '^(y|yes)$') {
                    Write-Color "    Enter security password: " White -NoNewline
                    $pass = Read-Host
                    if (-not [string]::IsNullOrWhiteSpace($pass)) {
                        Write-Step "Encrypting backup file with AES-256..."
                        $encFile = Encrypt-BackupFile -InPath $backupFile -Password $pass
                        Write-Ok "File encrypted successfully!"
                        Write-Color "    Encrypted File: $(Split-Path $encFile -Leaf)" DarkGray
                        
                        Write-Color "    Would you like to delete the unencrypted original backup file for security? (y/n): " White -NoNewline
                        $delChoice = Read-Host
                        if ($delChoice -match '^(y|yes)$') {
                            Remove-Item $backupFile -Force
                            Remove-Item $latestFile -Force
                            Write-Ok "Unencrypted source file deleted."
                        }
                    }
                }
            }
        } else {
            Write-Fail "pg_dump failed with exit code $LASTEXITCODE"
        }
    } catch {
        $ErrorActionPreference = 'Stop'
        Write-Fail "Backup operation encountered an error: $($_.Exception.Message)"
    }
    Pause-Menu
}

# -- Restore Implementation ---------------------------------------------------

function Invoke-Restore {
    $dbUrl = [System.Environment]::GetEnvironmentVariable("DATABASE_URL")
    if (-not $dbUrl) {
        Write-Fail "DATABASE_URL not found."
        Pause-Menu; return
    }

    $pgRestore = Get-PostgreSqlToolPath "pg_restore"
    if (-not $pgRestore) {
        Write-Fail "Could not locate 'pg_restore' utility."
        Write-Color "    Please ensure PostgreSQL command-line tools are installed." DarkGray
        Write-Color "    Download: https://www.postgresql.org/download/windows/" DarkGray
        Pause-Menu; return
    }

    $psql = Get-PostgreSqlToolPath "psql"

    $backupDir = Join-Path $PSScriptRoot "backups"
    if (-not (Test-Path $backupDir)) {
        Write-Warn "No backups directory found. Nothing to restore."
        Pause-Menu; return
    }

    $files = @(Get-ChildItem -Path $backupDir -Filter "*.dump" | Sort-Object LastWriteTime -Descending)
    if ($files.Count -eq 0) {
        Write-Warn "No .dump files found in $backupDir."
        Pause-Menu; return
    }

    Write-Banner
    Write-Color "    Available Backups to Restore:" White
    Write-Color "   --------------------------------------------------------------------" DarkMagenta
    for ($i = 0; $i -lt $files.Count; $i++) {
        $file   = $files[$i]
        $sizeMb = [Math]::Round($file.Length / 1MB, 3)
        $idx    = $i + 1
        Write-Color "    [$idx]" Magenta -NoNewline
        Write-Color "  $($file.Name) " White -NoNewline
        Write-Color "($sizeMb MB)  .  $($file.LastWriteTime)" DarkGray
    }
    Write-Color "    [Q]" DarkGray -NoNewline; Write-Color "  Cancel and return to menu" DarkGray
    Write-Host ""
    Write-Color "   --------------------------------------------------------------------" DarkMagenta
    Write-Color "    > Choose backup to restore: " White -NoNewline
    $ans = Read-Host
    if ($ans -match '^(q|quit|exit)$' -or [string]::IsNullOrWhiteSpace($ans)) { return }

    $val = $null
    if (-not [int]::TryParse($ans, [ref]$val) -or $val -lt 1 -or $val -gt $files.Count) {
        Write-Warn "Invalid choice."
        Pause-Menu; return
    }

    $targetFile = $files[$val - 1].FullName

    Write-Host ""
    Write-Warn "WARNING: Restoring will overwrite existing database schema and data!"
    $maskedUrl = $dbUrl -replace '(?<=:\/\/)[^:]+:[^@]+@', '***:***@'
    Write-Color "    Database URL:   $maskedUrl" DarkGray
    Write-Color "    Restore Source: $($files[$val - 1].Name)" Yellow
    Write-Color "    Type 'CONFIRM' (all caps) to execute restore: " White -NoNewline
    $confirm = Read-Host
    if ($confirm -ne 'CONFIRM') {
        Write-Warn "Restore cancelled by user."
        Pause-Menu; return
    }

    # Ask if the user wants a Super Clean Wipe
    $doSuperClean = $false
    if ($psql) {
        Write-Host ""
        Write-Color "    [SUPER CLEAN OPTION]" Yellow
        Write-Color "    Would you like to wipe the remote schema ('public') before restoring?" White
        Write-Color "    (This drops all existing tables/views/types to avoid duplicate constraint" DarkGray
        Write-Color "    conflicts and leftovers. Highly recommended for a perfect restore.)" DarkGray
        Write-Color "    Wipe 'public' schema first? (y/n): " White -NoNewline
        $wipeChoice = Read-Host
        if ($wipeChoice -match '^(y|yes)$') {
            $doSuperClean = $true
        }
    } else {
        Write-Host ""
        Write-Color "    (psql.exe not found; skipping Super Clean option, will use standard clean)" DarkGray
    }

    # Calculate optimal parallel jobs
    $cores = [Math]::Max(1, [int]$env:NUMBER_OF_PROCESSORS)
    $jobs = [Math]::Min(4, $cores)

    Write-Host ""
    if ($doSuperClean) {
        Write-Step "Wiping existing 'public' schema to prepare a clean slate..."
        try {
            $env:PGPASSWORD = $null
            $prevEAP = $ErrorActionPreference
            $ErrorActionPreference = 'SilentlyContinue'
            
            & $psql --dbname=$dbUrl -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" 2>&1 | ForEach-Object { "$_" } | Out-Host
            
            $ErrorActionPreference = $prevEAP
            if ($LASTEXITCODE -eq 0) {
                Write-Ok "Schema 'public' wiped and recreated successfully!"
            } else {
                Write-Warn "Failed to wipe schema (exit code $LASTEXITCODE). Attempting standard restore anyway."
            }
        } catch {
            $ErrorActionPreference = 'Stop'
            Write-Warn "Error wiping schema: $($_.Exception.Message). Proceeding to restore."
        }
    }

    Write-Step "Restoring database from backup..."
    if ($jobs -gt 1) {
        Write-Color "    Parallel Restore: Yes ($jobs threads / jobs)" DarkGray
    } else {
        Write-Color "    Parallel Restore: No (1 thread / job)" DarkGray
    }
    Write-Host ""

    try {
        $env:PGPASSWORD = $null
        $prevEAP = $ErrorActionPreference
        $ErrorActionPreference = 'SilentlyContinue'

        $restoreArgs = @()
        if ($jobs -gt 1) {
            $restoreArgs += "--jobs=$jobs"
        }
        $restoreArgs += "--clean"
        $restoreArgs += "--no-owner"
        $restoreArgs += "--no-privileges"
        $restoreArgs += "--dbname=$dbUrl"
        $restoreArgs += "-v"
        $restoreArgs += $targetFile

        & $pgRestore $restoreArgs 2>&1 | ForEach-Object { "$_" } | Out-Host
        
        $ErrorActionPreference = $prevEAP

        Write-Host ""
        if ($LASTEXITCODE -eq 0) {
            Write-Ok "Database restore completed successfully!"
        } else {
            Write-Warn "pg_restore finished with exit code $LASTEXITCODE. Please verify your database."
        }
    } catch {
        $ErrorActionPreference = 'Stop'
        Write-Fail "Restore operation encountered an error: $($_.Exception.Message)"
    }
    Pause-Menu
}

# -- Connection Verifier ------------------------------------------------------

function Invoke-VerifyConnection {
    $dbUrl = [System.Environment]::GetEnvironmentVariable("DATABASE_URL")
    if (-not $dbUrl) {
        Write-Fail "DATABASE_URL not found."
        Pause-Menu; return
    }

    Write-Step "Testing database connectivity..."

    $parsed = Parse-DatabaseUrl $dbUrl
    if ($parsed.Success) {
        Write-Color "    Server:   $($parsed.Host)" DarkGray
        Write-Color "    Port:     $($parsed.Port)" DarkGray
        Write-Color "    Database: $($parsed.Database)" DarkGray
        if ($parsed.User) {
            Write-Color "    User:     $($parsed.User)" DarkGray
        }

        Write-Step "Pinging network port $($parsed.Host)`:$($parsed.Port)..."
        $connectionTest = Test-NetConnection -ComputerName $parsed.Host -Port $parsed.Port -WarningAction SilentlyContinue
        if ($connectionTest.TcpTestSucceeded) {
            Write-Ok "Network port is OPEN and responding."
            Write-Ok "Credentials Check: Database connection string parsed successfully."
        } else {
            Write-Fail "Could not reach database port. Ensure the database server is online and firewall rules permit access."
        }
    } else {
        Write-Warn "Could not parse host from connection string. Ensure DATABASE_URL is valid."
    }
    Pause-Menu
}

# -- Decryption Implementation ------------------------------------------------

function Invoke-Decrypt {
    $backupDir = Join-Path $PSScriptRoot "backups"
    if (-not (Test-Path $backupDir)) {
        Write-Warn "No backups directory found."
        Pause-Menu; return
    }

    $files = @(Get-ChildItem -Path $backupDir -Filter "*.enc" | Sort-Object LastWriteTime -Descending)
    if ($files.Count -eq 0) {
        Write-Warn "No encrypted (.enc) files found in $backupDir."
        Pause-Menu; return
    }

    Write-Banner
    Write-Color "    Available Encrypted Backups to Decrypt:" White
    Write-Color "   --------------------------------------------------------------------" DarkMagenta
    for ($i = 0; $i -lt $files.Count; $i++) {
        $file   = $files[$i]
        $sizeMb = [Math]::Round($file.Length / 1MB, 3)
        $idx    = $i + 1
        Write-Color "    [$idx]" Magenta -NoNewline
        Write-Color "  $($file.Name) " White -NoNewline
        Write-Color "($sizeMb MB)  .  $($file.LastWriteTime)" DarkGray
    }
    Write-Color "    [Q]" DarkGray -NoNewline; Write-Color "  Cancel and return to menu" DarkGray
    Write-Host ""
    Write-Color "   --------------------------------------------------------------------" DarkMagenta
    Write-Color "    > Choose file to decrypt: " White -NoNewline
    $ans = Read-Host
    if ($ans -match '^(q|quit|exit)$' -or [string]::IsNullOrWhiteSpace($ans)) { return }

    $val = $null
    if (-not [int]::TryParse($ans, [ref]$val) -or $val -lt 1 -or $val -gt $files.Count) {
        Write-Warn "Invalid choice."
        Pause-Menu; return
    }

    $targetFile = $files[$val - 1].FullName
    $outFileName = $files[$val - 1].Name -replace '\.enc$', ''
    $outPath = Join-Path $backupDir $outFileName

    Write-Color "    Enter password: " White -NoNewline
    $pass = Read-Host
    if ([string]::IsNullOrWhiteSpace($pass)) {
        Write-Warn "Password cannot be empty."
        Pause-Menu; return
    }

    Write-Step "Decrypting $outFileName..."
    try {
        Decrypt-BackupFile -InPath $targetFile -Password $pass -OutPath $outPath
        Write-Ok "File decrypted successfully!"
        Write-Color "    Decrypted File: $outPath" Green
        
        Write-Color "    [APPLICATION RECOMMENDATIONS FOR VIEWING]" Yellow
        if ($outFileName.EndsWith(".sql")) {
            Write-Color "    - Text Editors:  Open this .sql file in VS Code, Notepad++, or Sublime Text." DarkGray
            Write-Color "                     You can read/search all raw INSERT and CREATE statements." DarkGray
            Write-Color "    - Database GUIs: Drag and drop this .sql file into DBeaver (highly recommended," DarkGray
            Write-Color "                     free, open-source) or pgAdmin to run queries or view structure." DarkGray
        } else {
            Write-Color "    - Database GUIs: Import this .dump file visually in DBeaver (free, open-source)" DarkGray
            Write-Color "                     using PostgreSQL client tools, or restore via this script." DarkGray
        }
    } catch {
        Write-Fail "Decryption failed: $($_.Exception.Message)"
    }
    Pause-Menu
}

# -- Dispatcher ---------------------------------------------------------------

function Invoke-Action([string] $key) {
    switch ($key.ToLower()) {
        '1'       { Invoke-Backup }
        'backup'  { Invoke-Backup }
        '2'       { Invoke-Restore }
        'restore' { Invoke-Restore }
        '3'       { Invoke-VerifyConnection }
        'verify'  { Invoke-VerifyConnection }
        '4'       { Invoke-Decrypt }
        'decrypt' { Invoke-Decrypt }
        default   {
            Write-Warn "Unknown option: '$key'"
            Start-Sleep -Milliseconds 800
        }
    }
}

# -- Main Entry ---------------------------------------------------------------

Load-DotEnv

if ($Action) {
    Invoke-Action $Action
    return
}

while ($true) {
    Write-Banner
    Write-Menu
    Write-Color "    > Choose an option: " White -NoNewline
    $choice = Read-Host

    if ([string]::IsNullOrWhiteSpace($choice)) { continue }
    if ($choice -match '^(q|quit|exit)$') {
        Write-Host ""
        Write-Color "    Goodbye." DarkGray
        Write-Host ""
        Start-Sleep -Milliseconds 400
        exit
    }

    Invoke-Action $choice
}
