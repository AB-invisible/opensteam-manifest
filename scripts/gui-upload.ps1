Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = "Manifest Uploader PRO"
$form.Size = New-Object System.Drawing.Size(650,500)
$form.StartPosition = "CenterScreen"
$form.BackColor = "#1e1e1e"

$font = New-Object System.Drawing.Font("Segoe UI",10)

# --- PATH ---
$txtPath = New-Object System.Windows.Forms.TextBox
$txtPath.Location = "20,20"
$txtPath.Size = "450,25"
$form.Controls.Add($txtPath)

$btnBrowse = New-Object System.Windows.Forms.Button
$btnBrowse.Text = "Browse"
$btnBrowse.Location = "480,20"
$form.Controls.Add($btnBrowse)

# --- API KEY ---
$txtKey = New-Object System.Windows.Forms.TextBox
$txtKey.Location = "20,60"
$txtKey.Size = "450,25"
$txtKey.UseSystemPasswordChar = $true
$form.Controls.Add($txtKey)

# --- PROGRESS ---
$progress = New-Object System.Windows.Forms.ProgressBar
$progress.Location = "20,100"
$progress.Size = "600,25"
$form.Controls.Add($progress)

# --- STATUS ---
$status = New-Object System.Windows.Forms.Label
$status.Location = "20,130"
$status.Size = "600,20"
$status.ForeColor = "White"
$form.Controls.Add($status)

# --- BUTTON ---
$btnStart = New-Object System.Windows.Forms.Button
$btnStart.Text = "START"
$btnStart.Location = "260,160"
$btnStart.Size = "120,35"
$form.Controls.Add($btnStart)

# --- LOG ---
$log = New-Object System.Windows.Forms.TextBox
$log.Multiline = $true
$log.ScrollBars = "Vertical"
$log.Location = "20,210"
$log.Size = "600,230"
$log.BackColor = "#111"
$log.ForeColor = "#0f0"
$form.Controls.Add($log)

# --- BROWSE ---
$btnBrowse.Add_Click({
    $f = New-Object System.Windows.Forms.FolderBrowserDialog
    if ($f.ShowDialog() -eq "OK") {
        $txtPath.Text = $f.SelectedPath
    }
})

# --- START ---
$btnStart.Add_Click({

    $folder = $txtPath.Text
    $apiKey = $txtKey.Text
    $server = "http://127.0.0.1:3000"

    if (!(Test-Path $folder)) {
        [System.Windows.Forms.MessageBox]::Show("Invalid folder")
        return
    }

    $files = Get-ChildItem $folder -File | Where-Object { $_.Extension -match '^\.(zip|rar|7z)$' }

    if ($files.Count -eq 0) {
        $log.AppendText("No files found`r`n")
        return
    }

    $total = $files.Count
    $progress.Maximum = $total
    $completed = 0

    $startTime = Get-Date

    # THREAD SAFE COUNTER
    $sync = [hashtable]::Synchronized(@{
        done = 0
    })

    # PARALLEL (runspaces)
    $pool = [runspacefactory]::CreateRunspacePool(1,5)
    $pool.Open()

    foreach ($file in $files) {

        $ps = [powershell]::Create()
        $ps.RunspacePool = $pool

        $ps.AddScript({
            param($file, $apiKey, $server, $sync)

            $appId = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
            $temp = [System.IO.Path]::GetTempFileName()

            $args = @(
                '-s','-o',$temp,'-w','%{http_code}',
                '-H',"Authorization: Bearer $apiKey",
                '-H',"X-API-Key: $apiKey",
                '-X','POST',
                '-F',"file=@$($file.FullName)",
                '-F',"appId=$appId",
                "$server/api/manifests/upload"
            )

            $code = & curl.exe @args

            if (Test-Path $temp) { Remove-Item $temp -Force }

            $sync.done++

            return "$($file.Name)|$code"
        }).AddArgument($file).AddArgument($apiKey).AddArgument($server).AddArgument($sync)

        $ps.BeginInvoke() | Out-Null
    }

    # TIMER UI UPDATE
    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = 300

    $timer.Add_Tick({

        $done = $sync.done
        $progress.Value = [Math]::Min($done, $total)

        $percent = [math]::Round(($done / $total) * 100, 1)

        $elapsed = (Get-Date) - $startTime
        if ($done -gt 0) {
            $avg = $elapsed.TotalSeconds / $done
            $remaining = $avg * ($total - $done)
            $eta = [TimeSpan]::FromSeconds($remaining)
        } else {
            $eta = [TimeSpan]::FromSeconds(0)
        }

        $status.Text = "$percent% | $done/$total | ETA: $([int]$eta.TotalSeconds)s"

        if ($done -ge $total) {
            $timer.Stop()
            $status.Text = "DONE"
            $log.AppendText("UPLOAD COMPLETE`r`n")
        }
    })

    $timer.Start()
})

$form.ShowDialog()