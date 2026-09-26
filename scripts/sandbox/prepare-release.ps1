# Prepares a release folder for the Windows Sandbox run (Windows PowerShell 5.1 compatible, ASCII only).
# Downloads the official portable Node zip, verifies it against nodejs.org SHASUMS256.txt and the pinned hash,
# copies run-in-sandbox.ps1 next to the OmniForge zip and renders omniforge-install.wsb into -Output.
param(
    [Parameter(Mandatory = $true)][string]$Release,
    [Parameter(Mandatory = $true)][string]$Output,
    [string]$NodeVersion = '24.19.0'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# From https://nodejs.org/dist/v24.19.0/SHASUMS256.txt, fetched 2026-09-26.
$pinned = @{ '24.19.0' = '57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73' }

$Release = (Resolve-Path -LiteralPath $Release).Path
New-Item -ItemType Directory -Force -Path $Output | Out-Null
$Output = (Resolve-Path -LiteralPath $Output).Path
if (-not (Get-ChildItem -LiteralPath $Release -Filter 'omniforge-*-win-x64.zip')) { throw "No omniforge-*-win-x64.zip in $Release; run: scripts\omniforge.cmd pack --out $Release" }

$name = "node-v$NodeVersion-win-x64.zip"
$base = "https://nodejs.org/dist/v$NodeVersion"
$sums = Join-Path $Release 'SHASUMS256.txt'
Invoke-WebRequest -UseBasicParsing -Uri "$base/SHASUMS256.txt" -OutFile $sums
$line = Select-String -LiteralPath $sums -Pattern ('^([0-9a-f]{64})\s+' + [regex]::Escape($name) + '$')
if (-not $line) { throw "$name is not listed in $base/SHASUMS256.txt" }
$expected = $line.Matches[0].Groups[1].Value
if ($pinned.ContainsKey($NodeVersion) -and $pinned[$NodeVersion] -ne $expected) { throw "SHASUMS256.txt disagrees with the pinned hash for $name" }

$zip = Join-Path $Release $name
if (-not (Test-Path -LiteralPath $zip) -or (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLower() -ne $expected) {
    Invoke-WebRequest -UseBasicParsing -Uri "$base/$name" -OutFile $zip
}
$actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLower()
if ($actual -ne $expected) { throw "sha256 mismatch for $zip ($actual, expected $expected); the file was left for inspection" }
Write-Host "Verified $name sha256 $actual"

Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'run-in-sandbox.ps1') -Destination $Release -Force
$wsb = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'omniforge-install.wsb.template') -Raw).Replace('__RELEASE_DIR__', $Release).Replace('__OUTPUT_DIR__', $Output)
Set-Content -LiteralPath (Join-Path $Output 'omniforge-install.wsb') -Value $wsb -Encoding UTF8
Write-Host "Ready: open $(Join-Path $Output 'omniforge-install.wsb'); the sandbox writes $(Join-Path $Output 'report.json')"
