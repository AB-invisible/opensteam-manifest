param(
    [Parameter(Mandatory=$true)]
    [string]$FolderPath,
    
    [Parameter(Mandatory=$true)]
    [string]$ServerUrl,

    [Parameter(Mandatory=$true)]
    [string]$ApiKey,
    
    [int]$MaxConcurrent = 3,
    [int]$RetryCount = 3
)

$ServerUrl = $ServerUrl.TrimEnd('/')

$files = Get-ChildItem -Path $FolderPath -File | Where-Object { $_.Extension -match '^\.(zip|rar|7z)$' } | Sort-Object Name
$total = $files.Count

if ($total -eq 0) {
    Write-Host "No manifest files found!" -ForegroundColor Yellow
    exit
}

$jobs = New-Object System.Collections.ArrayList
$success = 0
$fail = 0

function Start-UploadJob {
    param($file, $index)

    return Start-Job -ScriptBlock {
        param($f, $idx, $total, $url, $key, $retries)

        $appId = [System.IO.Path]::GetFileNameWithoutExtension($f)

        function Upload {
            param($FilePath, $AppId, $ServerUrl, $ApiKey)

            $temp = [System.IO.Path]::GetTempFileName()

            $args = @(
                '-s', '-o', $temp, '-w', '%{http_code}',
                '-H', "Authorization: Bearer $ApiKey",
                '-H', "X-API-Key: $ApiKey",
                '-X', 'POST',
                '-F', "file=@$FilePath",
                '-F', "appId=$AppId",
                "$ServerUrl/api/manifests/upload"
            )

            $code = & curl.exe @args
            if (Test-Path $temp) { Remove-Item $temp -Force }

            return $code
        }

        $attempt = 1
        $code = "000"

        while ($attempt -le $retries) {
            $code = Upload -FilePath $f -AppId $appId -ServerUrl $url -ApiKey $key
            if ($code -eq "200") { break }
            Start-Sleep -Seconds $attempt
            $attempt++
        }

        return @{
            File = $f
            AppId = $appId
            Code = $code
            Index = $idx
        }

    } -ArgumentList $file.FullName, $index, $total, $ServerUrl, $ApiKey, $RetryCount
}

for ($i = 0; $i -lt $total; $i++) {

    # wait if max concurrency reached
    while (($jobs | Where-Object { $_.State -eq 'Running' }).Count -ge $MaxConcurrent) {
        Start-Sleep -Milliseconds 200
    }

    $file = $files[$i]
    Write-Host "[$($i+1)/$total] Queuing $($file.Name)" -ForegroundColor Cyan

    $job = Start-UploadJob -file $file -index ($i + 1)
    $null = $jobs.Add($job)
}

Write-Host "Waiting for uploads..." -ForegroundColor Gray

while ($jobs.Count -gt 0) {

    foreach ($job in @($jobs)) {
        if ($job.State -eq "Completed") {

            $res = Receive-Job $job
            $jobs.Remove($job) | Out-Null
            Remove-Job $job

            $name = Split-Path $res.File -Leaf

            if ($res.Code -eq "200") {
                Write-Host "[$($res.Index)/$total] OK: $name" -ForegroundColor Green
                $success++
            } else {
                Write-Host "[$($res.Index)/$total] FAIL ($($res.Code)): $name" -ForegroundColor Red
                $fail++
            }
        }
    }

    Start-Sleep -Milliseconds 200
}

Write-Host ""
Write-Host "========== DONE ==========" -ForegroundColor Cyan
Write-Host "Success: $success" -ForegroundColor Green
Write-Host "Failed:  $fail" -ForegroundColor Red