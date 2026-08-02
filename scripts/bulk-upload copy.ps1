# Bulk Upload Script for Manifest Generator
# Uploads all manifest files (.zip, .rar, .7z) from a folder.
#
# Usage:
#   .\bulk-upload.ps1 -FolderPath "C:\path\to\manifests" -ServerUrl "https://your-app.railway.app"
#
# The script expects files named as {appId}.{ext} (e.g., 730.zip, 570.rar, 123.7z).
# It will use the filename (without extension) as the appId.
#
# Authentication: Use ADMIN_API_KEY for authorization. Provide it via the -ApiKey parameter.

param(
    [Parameter(Mandatory=$true)]
    [string]$FolderPath,
    
    [Parameter(Mandatory=$true)]
    [string]$ServerUrl,

    [Parameter(Mandatory=$true)]
    [string]$ApiKey,
    
    [Parameter(Mandatory=$false)]
    [int]$MaxConcurrent = 3,
    
    [Parameter(Mandatory=$false)]
    [int]$RetryCount = 3
)

# Remove trailing slash from server URL
$ServerUrl = $ServerUrl.TrimEnd('/')

# Get manifest files (.zip, .rar, .7z)
$manifestFiles = Get-ChildItem -Path $FolderPath -File | Where-Object { $_.Extension -match '^\.(zip|rar|7z)$' } | Sort-Object Name
$totalFiles = $manifestFiles.Count

if ($totalFiles -eq 0) {
    Write-Host "No .zip, .rar, or .7z files found in $FolderPath" -ForegroundColor Yellow
    exit 1
}

# Check for curl
if (!(Get-Command curl -ErrorAction SilentlyContinue)) {
    Write-Host "Error: 'curl' is not installed or not in your PATH. Please install it to use this script." -ForegroundColor Red
    exit 1
}

# Progress tracking
$startTime = Get-Date
$failedFiles = @()
$successCount = 0
$failCount = 0
$skipCount = 0

# Results log
$logPath = Join-Path $FolderPath "upload_log_$(Get-Date -Format 'yyyyMMdd_HHmmss').txt"

# --- Upload Function ---
function Upload-ZipFile {
    param(
        [string]$FilePath,
        [string]$AppId,
        [int]$Index,
        [int]$Total
    )

    $fileName = Split-Path $FilePath -Leaf
    $fileSize = (Get-Item $FilePath).Length
    $fileSizeMB = [math]::Round($fileSize / 1MB, 2)
    
    Write-Host "[$Index/$Total] Uploading $fileName ($fileSizeMB MB) ..." -ForegroundColor Cyan

    for ($attempt = 1; $attempt -le $RetryCount; $attempt++) {
        try {
            # Use a temporary file for the body to avoid shell encoding/slicing issues
            $tempBody = [System.IO.Path]::GetTempFileName()
            
            $curlArgs = @('-s', '-o', $tempBody, '-w', '%{http_code}')
            if ($ApiKey) {
                $curlArgs += '-H'
                $curlArgs += "Authorization: Bearer $ApiKey"
                $curlArgs += '-H'
                $curlArgs += "X-API-Key: $ApiKey"
            }

            $curlArgs += @(
                '-X', 'POST',
                '-F', "file=@$FilePath",
                '-F', "appId=$AppId",
                '-F', "name=Manifest $AppId",
                "$ServerUrl/api/manifests/upload"
            )

            $httpCode = & curl.exe @curlArgs
            $body = Get-Content -Path $tempBody -Raw
            if (Test-Path $tempBody) { Remove-Item $tempBody -ErrorAction SilentlyContinue }

            if ($httpCode -eq '200') {
                Write-Host " OK ($fileName)" -ForegroundColor Green
                return $true
            } elseif ($httpCode -eq '413') {
                Write-Host " TOO LARGE ($fileName)" -ForegroundColor Yellow
                return $false
            } else {
                if ($attempt -lt $RetryCount) {
                    Write-Host " RETRY ($attempt/$RetryCount): $httpCode" -ForegroundColor Yellow
                    Start-Sleep -Seconds (2 * $attempt)
                } else {
                    Write-Host " FAILED ($httpCode): $fileName" -ForegroundColor Red
                    return $false
                }
            }
        } catch {
            if ($attempt -lt $RetryCount) {
                Write-Host " ERROR, retrying..." -ForegroundColor Yellow
                Start-Sleep -Seconds (2 * $attempt)
            } else {
                Write-Host " ERROR ($fileName): $_" -ForegroundColor Red
                return $false
            }
        }
    }
    return $false
}

# --- Main Execution ---
$jobs = @()
$completedCount = 0

for ($i = 0; $i -lt $totalFiles; $i++) {
    $file = $manifestFiles[$i]
    $appId = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
    
    # Process any completed jobs BEFORE queuing more
    $completedJobs = $jobs | Where-Object { $_.State -eq 'Completed' }
    foreach ($job in $completedJobs) {
        $data = $job | Receive-Job
        if ($data -and $data.File) {
            $completedCount++
            $fileName = Split-Path $data.File -Leaf
            if ($data.Success) {
                Write-Host "[$($data.Index)/$totalFiles] OK: $fileName" -ForegroundColor Green
                $successCount++
                Add-Content -Path $logPath -Value "OK    $($data.File) -> $($data.AppId)"
            } else {
                Write-Host "[$($data.Index)/$totalFiles] FAILED ($($data.HttpCode)): $fileName" -ForegroundColor Red
                $failCount++
                $failedFiles += $data.File
                Add-Content -Path $logPath -Value "FAIL  $($data.File) -> $($data.AppId) (Code: $($data.HttpCode))"
            }
            # Remove from tracking array once processed
            $jobs = $jobs | Where-Object { $_.Id -ne $job.Id }
            $job | Remove-Job
        }
    }

    # Simple rate limiting/concurrency check
    while (($jobs | Where-Object { $_.State -eq 'Running' }).Count -ge $MaxConcurrent) {
        # Check for completions while waiting
        $finished = $jobs | Where-Object { $_.State -eq 'Completed' }
        if ($finished) { break } # Jump out to process the completion
        Start-Sleep -Milliseconds 200
    }

    if ($appId -match '^\d+$' -or $appId -match '^[a-zA-Z0-9_-]+$') {
        $sizeFriendly = if ($file.Length -lt 1KB) { "$($file.Length) B" } elseif ($file.Length -lt 1MB) { "$([math]::Round($file.Length / 1KB, 1)) KB" } else { "$([math]::Round($file.Length / 1MB, 1)) MB" }
        Write-Host "[$($i+1)/$totalFiles] Queuing $($file.Name) ($sizeFriendly) ..." -ForegroundColor Cyan
        
        # Using background jobs for concurrency
        $jobs += Start-Job -ScriptBlock {
            param($f, $id, $idx, $total, $url, $key, $retries)
            
            function Internal-Upload {
                param($FilePath, $AppId, $Index, $Total, $ServerUrl, $ApiKey, $RetryCount)
                $tempBody = [System.IO.Path]::GetTempFileName()
                $curlArgs = @('-s', '-o', $tempBody, '-w', '%{http_code}')
                if ($ApiKey) { 
                    $curlArgs += '-H'; $curlArgs += "Authorization: Bearer $ApiKey"
                    $curlArgs += '-H'; $curlArgs += "X-API-Key: $ApiKey"
                }
                $curlArgs += @('-X', 'POST', '-F', "file=@$FilePath", '-F', "appId=$AppId", '-F', "name=Manifest $AppId", "$ServerUrl/api/manifests/upload")
                $code = & curl.exe @curlArgs
                if (Test-Path $tempBody) { Remove-Item $tempBody -ErrorAction SilentlyContinue }
                return $code
            }

            $attempt = 1
            $success = $false
            $hCode = "000"
            while ($attempt -le $retries) {
                $hCode = Internal-Upload -FilePath $f -AppId $id -Index $idx -Total $total -ServerUrl $url -ApiKey $key -RetryCount $retries
                if ($hCode -eq "200") { $success = $true; break }
                $attempt++
                Start-Sleep -Seconds 1
            }
            return @{ Success = $success; File = $f; AppId = $id; HttpCode = $hCode; Index = $idx }
        } -ArgumentList $file.FullName, $appId, ($i + 1), $totalFiles, $ServerUrl, $ApiKey, $RetryCount
    } else {
        Write-Host "[$($i+1)/$totalFiles] Skipping $($file.Name) (invalid name)" -ForegroundColor Yellow
        $skipCount++
    }
}

# Final cleanup of remaining jobs
Write-Host "Waiting for last few uploads to finish..." -ForegroundColor Gray
while ($jobs.Count -gt 0) {
    foreach ($job in $jobs | Where-Object { $_.State -eq 'Completed' }) {
        $data = $job | Receive-Job
        if ($data -and $data.File) {
            $completedCount++
            $fileName = Split-Path $data.File -Leaf
            if ($data.Success) {
                Write-Host "[$($data.Index)/$totalFiles] OK: $fileName" -ForegroundColor Green
                $successCount++
            } else {
                Write-Host "[$($data.Index)/$totalFiles] FAILED ($($data.HttpCode)): $fileName" -ForegroundColor Red
                $failCount++
                $failedFiles += $data.File
            }
            $jobs = $jobs | Where-Object { $_.Id -ne $job.Id }
            $job | Remove-Job
        }
    }
    if ($jobs.Count -gt 0) { Start-Sleep -Milliseconds 500 }
}


$elapsed = (Get-Date) - $startTime

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Upload Complete!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Success:  $successCount" -ForegroundColor Green
Write-Host "Failed:   $failCount" -ForegroundColor $(if ($failCount -gt 0) {"Red"} else {"White"})
Write-Host "Skipped:  $skipCount" -ForegroundColor $(if ($skipCount -gt 0) {"Yellow"} else {"White"})
Write-Host "Time:     $([math]::Round($elapsed.TotalMinutes, 1)) minutes"
Write-Host "Log:      $logPath"

if ($failedFiles.Count -gt 0) {
    Write-Host ""
    Write-Host "Failed Files Summary:" -ForegroundColor Red
    foreach ($f in $failedFiles) {
        Write-Host " - $f" -ForegroundColor Red
    }
}

Write-Host "========================================" -ForegroundColor Cyan
