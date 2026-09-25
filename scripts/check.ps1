# Windows runner. No installs; -Python or OMNIHARNESS_PYTHON selects another existing runtime.
param([string]$Python = $env:OMNIHARNESS_PYTHON)
$ErrorActionPreference = 'Stop'
if (-not $Python) {
    $bundled = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
    $Python = if (Test-Path -LiteralPath $bundled) { $bundled } else { (Get-Command python -ErrorAction Stop).Source }
}
$Python = (Resolve-Path -LiteralPath $Python).Path
& $Python -c 'import sys; print(sys.executable); print(sys.version); sys.exit(0 if sys.version_info >= (3,12) else 1)'
if ($LASTEXITCODE -ne 0) { throw 'Python 3.12 or newer is required.' }

# Set PATH inside Python: the bundled runtime can rebuild it during startup.
$testBootstrap = @'
import os, pathlib, sys, unittest
os.environ["PATH"] = str(pathlib.Path(sys.executable).parent) + os.pathsep + os.environ.get("PATH", "")
suite = unittest.defaultTestLoader.discover("tests")
result = unittest.TextTestRunner(verbosity=2, warnings="default").run(suite)
if result.skipped:
    print("Incomplete coverage: skipped tests are not accepted.", file=sys.stderr)
sys.exit(0 if result.wasSuccessful() and not result.skipped else 1)
'@
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
    & $Python -c $testBootstrap
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    foreach ($test in @('tests/test_driver.js', 'tests/test_scout_driver.js', 'tests/test_swarm_driver.js', 'tests/test_site.js')) {
        & node $test
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    & npm --prefix omniforge-lab test
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $Python evals/run.py selftest
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $Python scripts/install.py --check
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & $Python .agents/skills/skills-graph/scripts/skills_graph.py check
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
