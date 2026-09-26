# Clean-machine acceptance run for an OmniForge release (Windows PowerShell 5.1 compatible, ASCII only).
# Verifies and installs the release zip, runs doctor and repair, starts the installed Lab, probes it with its
# printed token, stops it through stdin EOF, uninstalls with --apply --remove-data and writes report.json.
# Windows Sandbox starts it from omniforge-install.wsb; on a normal host pass a disposable -Prefix.
param(
    [Parameter(Mandatory = $true)][string]$Release,
    [Parameter(Mandatory = $true)][string]$Output,
    [string]$Prefix = (Join-Path $env:LOCALAPPDATA 'OmniForge'),
    [switch]$PortableNode
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
New-Item -ItemType Directory -Force -Path $Output | Out-Null
$tar = Join-Path $env:SystemRoot 'System32\tar.exe'
$steps = New-Object System.Collections.ArrayList
$report = [ordered]@{ startedAt = (Get-Date).ToString('o'); computer = $env:COMPUTERNAME; user = $env:USERNAME
    windows = [Environment]::OSVersion.VersionString; prefix = $Prefix; steps = $steps; passed = $false }

function Hide-Token([string]$Text) { return ($Text -replace 'token=[0-9a-f]+', 'token=<redacted>') }

function New-CmdProcess([string]$CommandLine, [switch]$Stdin) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = Join-Path $env:SystemRoot 'System32\cmd.exe'
    $psi.Arguments = '/d /s /c "' + $CommandLine + ' 2>&1"'
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardInput = [bool]$Stdin
    $psi.StandardOutputEncoding = [Text.Encoding]::UTF8
    return [Diagnostics.Process]::Start($psi)
}

function Invoke-Step([string]$Name, [string]$CommandLine) {
    $process = New-CmdProcess $CommandLine
    $text = $process.StandardOutput.ReadToEnd()
    $process.WaitForExit()
    $step = [ordered]@{ name = $Name; exit = $process.ExitCode; output = @((Hide-Token $text).TrimEnd() -split "`r?`n") }
    [void]$steps.Add($step)
    Write-Host "== $Name (exit $($process.ExitCode))"
    Write-Host $text
    return $step
}

function Get-Status([string]$Uri, [hashtable]$Headers) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -Headers $Headers -TimeoutSec 60
        return @{ status = [int]$response.StatusCode; body = $response.Content }
    } catch [System.Net.WebException] {
        if ($_.Exception.Response) { return @{ status = [int]$_.Exception.Response.StatusCode; body = '' } }
        return @{ status = 0; body = $_.Exception.Message }
    }
}

$exitCode = 1
try {
    $zip = Get-ChildItem -LiteralPath $Release -Filter 'omniforge-*-win-x64.zip' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $zip) { throw "no omniforge-*-win-x64.zip in $Release" }
    $report.release = $zip.Name
    $expected = ((Get-Content -LiteralPath ($zip.FullName + '.sha256') -Raw).Trim() -split '\s+')[0].ToLower()
    $report.zipSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip.FullName).Hash.ToLower()
    if ($report.zipSha256 -ne $expected) { throw "sha256 mismatch for $($zip.Name)" }

    # Node: the installed one, or the portable zip verified against the official SHASUMS256.txt.
    if ($PortableNode -or -not (Get-Command node -ErrorAction SilentlyContinue)) {
        $nodeZip = Get-ChildItem -LiteralPath $Release -Filter 'node-v*-win-x64.zip' | Select-Object -First 1
        if (-not $nodeZip) { throw 'Node.js is missing and the release folder has no node-v*-win-x64.zip (run prepare-release.ps1)' }
        $line = Select-String -LiteralPath (Join-Path $Release 'SHASUMS256.txt') -Pattern ('^([0-9a-f]{64})\s+' + [regex]::Escape($nodeZip.Name) + '$')
        if (-not $line -or (Get-FileHash -Algorithm SHA256 -LiteralPath $nodeZip.FullName).Hash.ToLower() -ne $line.Matches[0].Groups[1].Value) {
            throw "$($nodeZip.Name) does not match SHASUMS256.txt"
        }
        $nodeRoot = Join-Path $env:TEMP 'omniforge-portable-node'
        New-Item -ItemType Directory -Force -Path $nodeRoot | Out-Null
        & $tar -x -f $nodeZip.FullName -C $nodeRoot
        if ($LASTEXITCODE -ne 0) { throw 'could not extract the portable Node zip' }
        $env:Path = (Join-Path $nodeRoot $nodeZip.BaseName) + ';' + $env:Path
        $report.node = 'portable ' + $nodeZip.Name + ' (sha256 matched SHASUMS256.txt)'
    } else {
        $report.node = 'installed ' + (Get-Command node).Source
    }
    $report.nodeVersion = (& node --version)

    # Bootstrap: the installer itself ships inside the verified zip.
    $boot = Join-Path $env:TEMP ('omniforge-bootstrap-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $boot | Out-Null
    & $tar -x -f $zip.FullName -C $boot scripts/omniforge.cmd omniforge-lab/manage.mjs
    if ($LASTEXITCODE -ne 0) { throw 'could not extract the installer from the release zip' }
    $install = Invoke-Step 'install' ('"' + (Join-Path $boot 'scripts\omniforge.cmd') + '" install --from "' + $zip.FullName + '" --prefix "' + $Prefix + '"')
    Remove-Item -LiteralPath $boot -Recurse -Force
    $launcher = Join-Path $Prefix 'omniforge.cmd'
    if (-not (Test-Path -LiteralPath $launcher)) { throw 'install did not create the launcher' }
    $doctor = Invoke-Step 'doctor' ('"' + $launcher + '" doctor')
    $repair = Invoke-Step 'repair (verify installed files)' ('"' + $launcher + '" repair')

    # Windows cannot send Ctrl+C to a process without a shared console, so the run stops it by closing stdin.
    $server = New-CmdProcess ('"' + $launcher + '" start --stop-on-eof') -Stdin
    $lines = New-Object System.Collections.ArrayList
    $url = $null
    $deadline = (Get-Date).AddSeconds(90)
    while (-not $url -and (Get-Date) -lt $deadline) {
        $read = $server.StandardOutput.ReadLineAsync()
        if (-not $read.Wait([int][Math]::Max(1, ($deadline - (Get-Date)).TotalMilliseconds)) -or $null -eq $read.Result) { break }
        [void]$lines.Add($read.Result)
        if ($read.Result -match 'OmniForge Lab: (http://127\.0\.0\.1:\d+)/\?token=([0-9a-f]+)') { $url = $Matches[1]; $token = $Matches[2] }
    }
    if (-not $url) {
        if (-not $server.HasExited) { $server.Kill() }
        $report.start = [ordered]@{ output = @($lines | ForEach-Object { Hide-Token $_ }) }
        throw 'the installed Lab did not print its URL within 90 s'
    }
    $auth = @{ 'X-OmniForge-Token' = $token }
    $root = Get-Status "$url/" @{}
    $state = Get-Status "$url/api/state" $auth
    $denied = Get-Status "$url/api/state" @{}
    $catalog = Get-Status "$url/api/skills?ring=installed&limit=5" $auth
    $parsed = $null
    if ($state.status -eq 200) { $parsed = $state.body | ConvertFrom-Json }
    $report.probe = [ordered]@{ url = $url; root = $root.status; rootIsLab = [bool]($root.body -match 'OmniForge'); state = $state.status
        stateProjects = $(if ($parsed) { @($parsed.projects).Count } else { $null }); stateSkills = $(if ($parsed) { @($parsed.skills).Count } else { $null })
        stateWithoutToken = $denied.status; skillsCatalog = $catalog.status }

    $server.StandardInput.Close()
    $stopped = $server.WaitForExit(60000)
    if (-not $stopped) { $server.Kill() }
    foreach ($line in ($server.StandardOutput.ReadToEnd() -split "`r?`n")) { if ($line) { [void]$lines.Add($line) } }
    $report.start = [ordered]@{ exit = $(if ($stopped) { $server.ExitCode } else { $null }); stoppedByStdinEof = $stopped
        lockLeft = (Test-Path -LiteralPath (Join-Path $Prefix 'data\state.lock')); output = @($lines | ForEach-Object { Hide-Token $_ }) }

    $triage = Invoke-Step 'uninstall (triage only)' ('"' + $launcher + '" uninstall')
    $removal = Invoke-Step 'uninstall --apply --remove-data' ('"' + $launcher + '" uninstall --apply --remove-data')
    $at = [array]::IndexOf($removal.output, 'Residue after uninstall:')
    $report.residue = $(if ($at -ge 0) { @($removal.output[($at + 1)..($removal.output.Count - 1)]) } else { @() })
    $report.prefixLeft = Test-Path -LiteralPath $Prefix
    $report.doctorOk = ($doctor.exit -eq 0)
    $report.passed = ($install.output -match '^Installed OmniForge').Count -gt 0 -and $repair.exit -eq 0 -and
        $report.probe.root -eq 200 -and $report.probe.rootIsLab -and $report.probe.state -eq 200 -and $report.probe.stateWithoutToken -eq 403 -and
        $stopped -and $server.ExitCode -eq 0 -and -not $report.start.lockLeft -and $triage.exit -eq 0 -and $removal.exit -eq 0 -and -not $report.prefixLeft
    if ($report.passed) { $exitCode = 0 }
} catch {
    $report.error = $_.Exception.Message
    Write-Host "ERROR: $($_.Exception.Message)"
} finally {
    $report.finishedAt = (Get-Date).ToString('o')
    $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $Output 'report.json') -Encoding UTF8
    Write-Host "Report: $(Join-Path $Output 'report.json') (passed: $($report.passed))"
}
exit $exitCode
