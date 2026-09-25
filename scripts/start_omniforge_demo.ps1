# Foreground, disposable-data OmniForge Lab demonstration.
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 ou mais recente é necessário.' }
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$lab = Join-Path $repoRoot 'omniforge-lab'
$node = Get-Command node -ErrorAction Stop
$version = (& $node.Source --version)
if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v(\d+)\.') { throw 'Não foi possível verificar a versão do Node.js.' }
if ([int]$Matches[1] -lt 22) { throw 'Node.js 22 ou mais recente é necessário.' }

Push-Location $lab
try {
    function Test-LabDependencies {
        & $node.Source -e "require('node-pty'); require.resolve('@xterm/xterm'); require.resolve('@xterm/addon-fit')" *> $null
        return $LASTEXITCODE -eq 0
    }
    if (-not (Test-LabDependencies)) {
        if (-not (Test-Path -LiteralPath (Join-Path $lab 'package-lock.json'))) { throw 'package-lock.json do Lab ausente; dependências não podem ser instaladas com npm ci.' }
        $npm = Get-Command npm -ErrorAction Stop
        Write-Host 'Dependências do Lab ausentes; instalando a partir do package-lock.json com npm ci...'
        & $npm.Source ci --prefix $lab
        if ($LASTEXITCODE -ne 0 -or -not (Test-LabDependencies)) { throw 'A instalação ou verificação das dependências do Lab falhou.' }
    }
    & $node.Source (Join-Path $lab 'demo.mjs')
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    Pop-Location
}
