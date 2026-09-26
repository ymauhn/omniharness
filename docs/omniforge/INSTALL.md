# OmniForge on Windows: install, launch, update, recover, remove

Status: **V1 hard gate 1 tooling, 2026-09-26.** Pack, install, start, update, rollback, repair and uninstall are implemented in `omniforge-lab/manage.mjs` and covered by `omniforge-lab/test/manage.test.mjs`. A real smoke on the development host is recorded under [Evidence](#evidence). The clean-user run in Windows Sandbox is **pending**: the feature is not enabled on the owner's machine yet (see [Windows Sandbox](#windows-sandbox-clean-user-run)). This is not a signed installer, an MSI or a release certificate.

Every command goes through `scripts\omniforge.cmd <command>`, which runs `omniforge-lab\manage.mjs <command>` with the `node.exe` it finds in the PATH folders, never one in the current folder. It works from a source checkout, from an extracted release zip and from an install.

## What a release is

`omniforge-<version>-<shortsha>-win-x64.zip` plus a sibling `.sha256` (`<sha256>  <zip name>`). The zip holds what the installed Lab reads at runtime, cut from `HEAD` with `git archive`:

| Path | Why the Lab needs it |
|---|---|
| `omniforge-lab/` (without `test/`) | server, demo, services and page modules |
| `omniforge-lab/node_modules/` | production dependencies from `package-lock.json` (`npm ci --omit=dev --ignore-scripts`), so install needs no network; node-pty loads its bundled win32 prebuild |
| `.agents/skills/` | `listSkills` and the skills-graph scanner behind `harness.catalog_api` |
| `harness/catalog_api.py`, `skill_catalog.py`, `agent_arsenal*.py`, `agent_profiles.json`, `classifier_worker.py`, `prompt_classifier.py` | skills catalog, Agent Arsenal bridge and the Laya classifier worker |
| `docs/catalog/*.md` (3 tables), `docs/skills-graph/skill-metadata.json`, `docs/experiments/laya-artifacts-2026-09-25.json` | catalog rows, metadata overlay and the classifier manifest |
| `scripts/omniforge.cmd`, `docs/omniforge/INSTALL.md`, `LICENSE` | the manager, this guide, the licence |
| `omniforge-build.json` | build manifest: version, full git sha, Node version, build time and the sha256 of every file |

Laya still needs its local runtime under `.omniharness/runtime` to be activated separately; the release does not ship model weights.

## Prerequisites

`omniforge doctor` checks each one and prints one row per item with `ok`, `degraded` or `missing`, plus one `->` line saying what to do. It exits 0 only when the required rows are `ok`.

| Row | Required | Check | Fix it prints |
|---|---|---|---|
| node | yes | Node.js 22 or newer | `winget install -e --id OpenJS.NodeJS.LTS` (or https://nodejs.org/en/download) |
| lab | yes | loads node-pty and the xterm assets, resolves the terminal shell, and compares node-pty with the pinned version | `npm ci --prefix omniforge-lab` (checkout) or `omniforge repair` (install) |
| python | yes | runs `OMNIHARNESS_PYTHON`, else the bundled Codex runtime, `py -3`, `python`, and requires 3.11+ with `tomllib`; the Microsoft Store alias fails this because it exits 9009 without running Python | `winget install -e --id Python.Python.3.12` or set `OMNIHARNESS_PYTHON` |
| git | no | `git --version`; only `pack` needs it | `winget install -e --id Git.Git` |
| claude | no | `where claude`, then `claude auth status --json` (10 s timeout) | `npm install -g @anthropic-ai/claude-code`, then `claude auth login` |
| codex | no | `where codex`, then `codex login status` (10 s timeout) | `npm install -g @openai/codex`, then `codex login` |

The host rows are read-only. Doctor never opens a credential file and never prints the status output: it reports only absent, logged out, API key (with the key's source name, such as `ANTHROPIC_API_KEY`) or subscription. Nothing is copied into a worker. If Node itself is missing, `omniforge.cmd` prints the winget command and the nodejs.org URL and exits 9009. The manager never installs system software.

`start` passes the Python that doctor found to the Lab as `OMNIHARNESS_PYTHON`, so `py -3` works even when `python` on PATH is only the Store alias.

Doctor, `pack` and every other program the manager starts are resolved from the PATH folders and run by absolute path. Windows would otherwise try the current folder first, so a stray `git.exe`, `py.exe` or `claude.cmd` in the folder that holds the download would run. The children also get `NoDefaultCurrentDirectoryInExePath=1`, so an npm shim such as `claude.cmd` that starts `node` by name does not pick one from the current folder either.

## Build a release (maintainer)

```powershell
scripts\omniforge.cmd pack --out dist
```

`pack` refuses a tree with tracked changes. Untracked files are ignored because the release is cut from `HEAD`. It needs the npm registry or cache at pack time only. It writes `dist\omniforge-0.1.0-<shortsha>-win-x64.zip` and its `.sha256`. The version comes from `omniforge-lab/package.json`.

## Install

1. Put the zip and its `.sha256` in one folder, then compare `(Get-FileHash .\omniforge-0.1.0-<sha>-win-x64.zip -Algorithm SHA256).Hash` with the first word of the `.sha256` file.
2. Take the installer out of the zip. The built-in `tar` reads zip files:
   `mkdir $env:TEMP\omniforge-setup; tar -x -f .\omniforge-0.1.0-<sha>-win-x64.zip -C $env:TEMP\omniforge-setup scripts/omniforge.cmd omniforge-lab/manage.mjs`
3. `& "$env:TEMP\omniforge-setup\scripts\omniforge.cmd" install --from .\omniforge-0.1.0-<sha>-win-x64.zip`

The default prefix is `%LOCALAPPDATA%\OmniForge`; `--prefix <dir>` changes it. `install` verifies the `.sha256` and extracts into a temporary folder. It hashes every file that the manifest lists before moving the folder into place, then runs doctor. A file in the zip that the manifest does not list is not hashed on its own; only the zip's `.sha256` covers it. Installing the same zip again keeps the installed files, the previous version and the recorded state backup. A different version must go through `update`.

`install` creates `data\` with a marker file, `.omniforge-install`, and records it. A `data\` folder that already existed without that marker, for example under `--prefix D:\Tools`, is used by the Lab but never recorded, so no uninstall removes it. Install says so when it finds one.

| Path under the prefix | What it is |
|---|---|
| `app\<version>-<shortsha>\` | one folder per installed version, side by side |
| `releases\<zip>` and `.sha256` | verified copy used by `repair` |
| `data\` | Lab state (`OMNIFORGE_DATA_DIR`), kept outside every app folder; `.omniforge-install` marks a folder the install created |
| `run\` | `<pid>.json` for each running `start`, Lab or demo; removed when that process exits |
| `current.json` | active version and the previous one |
| `install.json` | every path the install created, with its kind |
| `omniforge.cmd` | launcher that forwards to the active version |

## Launch

```powershell
& "$env:LOCALAPPDATA\OmniForge\omniforge.cmd" start          # prints: OmniForge Lab: http://127.0.0.1:<port>/?token=<token>
& "$env:LOCALAPPDATA\OmniForge\omniforge.cmd" start --demo   # disposable synthetic demo in %TEMP%\omniforge-demo-*
```

Open the exact printed URL. Opening `index.html` as a file does not work. `start` writes `run\<pid>.json` before it loads the Lab or demo and removes it on exit, so `uninstall --apply` can see a demo that holds no data lock. `OMNIFORGE_PORT` fixes the port; the default is a random free port. Ctrl+C closes the sessions and the server, which releases `data\state.lock`. `start --stop-on-eof` also stops when its standard input closes. Supervisors and the acceptance script use that, because Windows cannot deliver Ctrl+C to a process that does not share a console with the sender.

## Update and roll back

```powershell
# Take the NEW release's manager out of its zip (Install steps 1-2), then let it update the install:
& "$env:TEMP\omniforge-setup\scripts\omniforge.cmd" update --from .\omniforge-0.2.0-<sha>-win-x64.zip
& "$env:LOCALAPPDATA\OmniForge\omniforge.cmd" rollback
```

The manager you run is the one that performs the update. The new release's copy therefore brings its own update fixes. `"%LOCALAPPDATA%\OmniForge\omniforge.cmd" update --from ...` also works, but it runs the installed, older manager (see Evidence: a fix made in `ab7195f` applies only when that version's manager runs the update).

`update` refuses while a running Lab holds `data\state.lock`. It uses the Lab's own lock semantics read-only: a live pid, an unreadable lock or a `state.recovery.lock` all count as running. It copies `data\state.json` to `state.json.pre-<new version>` and never overwrites a backup: an update after a rollback that finds different content writes `state.json.pre-<new version>.1`, `.2` and so on. It then installs the new version next to the old one, switches `current.json` and the launcher, runs doctor and prints the rollback command. `current.json` records the exact backup this update took, and reinstalling the same zip keeps that record. `rollback` switches back to the previous version and names that file, not an older `.pre-*` from an earlier cycle. It never overwrites data by itself.

## Repair

`repair` hashes every file that the active version's installed `omniforge-build.json` lists and compares it with the hash recorded there. This first pass trusts the installed manifest: a file changed together with its hash in that manifest passes. If a listed file differs or is missing, or the manifest cannot be read, it checks the recorded zip under `releases\` against the `.sha256` copied next to it, takes the manifest from that zip and restores the listed files that differ from it, plus the manifest itself. Files outside the manifest are ignored, for example the `harness\__pycache__` that Python writes when the catalog runs; uninstall removes them with the app folder. It then lists stale lock files for triage: a `state.lock` whose pid is gone, preserved `state.lock.stale-*` files and a leftover `state.recovery.lock`. It never deletes them.

## Uninstall

```powershell
& "$env:LOCALAPPDATA\OmniForge\omniforge.cmd" uninstall                            # triage list only
& "$env:LOCALAPPDATA\OmniForge\omniforge.cmd" uninstall --apply                    # remove recorded paths, keep data
& "$env:LOCALAPPDATA\OmniForge\omniforge.cmd" uninstall --apply --remove-data      # also remove data\
```

Without `--apply`, uninstall prints the numbered list `N. <path>: <reason>; <evidence>` and removes nothing. `--apply` refuses while a Lab holds `data\state.lock` and while any `start` from this install, Lab or demo, is alive according to its `run\<pid>.json`; a record whose pid is gone does not block. A reused pid reads as running until its record is deleted by hand. It removes only paths that `install.json` records inside the prefix. Folders are removed only when empty, and `data\` only with `--remove-data`. Install records `data\` only when the marker shows it created the folder, which includes a folder that an earlier `uninstall --apply` kept. A `data\` folder that existed before the install survives `--remove-data` and appears in the residue report. The data guard works by containment: a recorded path inside `data\` is never removed on its own, and a recorded folder above it, such as the prefix, is removed only when empty. Paths are compared the way Windows does, ignoring case, so `--prefix c:\users\me\...\omniforge` still recognises `data\` and keeps it. It then rescans and prints a residue report. `%TEMP%\omniforge-demo-*` folders from past demos are listed for triage and never deleted. Node.js, Python, Git and the host CLIs are never touched.

## Troubleshooting

- **"Microsoft Visual C++ Runtime Library: Assertion failed! ... node-pty\prebuilds\win32-x64\conpty.node ... conpty.cc Line 106, remove_pty_baton(baton->id)".** node-pty 1.1.0 removed exited ConPTYs from an unlocked list. Two shells exiting together, for example at demo shutdown, hit that compiled-in assert. You do not need to download or install anything: the lockfile pins 1.2.0-beta.15, which fixes it. Doctor shows `degraded lab node-pty 1.1.0 installed but 1.2.0-beta.15 is pinned` when an old copy is still installed. Run `npm ci --prefix omniforge-lab` in a checkout, or `repair` for an install, then restart any Lab or demo process that started before the fix; a running process keeps the old addon loaded. If the dialog is already open, Ignore lets that process continue and Abort ends it.
- `Other OmniForge instance uses this data` or `update` refusing: stop the running Lab first. `repair` lists stale locks for manual triage.

## Windows Sandbox (clean-user run)

`scripts\sandbox\` holds a clean-machine acceptance run. No agent has launched it, because Windows Sandbox is not enabled on this machine. Owner steps:

1. Once, in an elevated PowerShell (Windows 11 Pro, virtualization on): `Enable-WindowsOptionalFeature -Online -FeatureName Containers-DisposableClientVM -All`, then reboot.
2. From a clean checkout: `scripts\omniforge.cmd pack --out C:\OmniForgeRelease`
3. `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\sandbox\prepare-release.ps1 -Release C:\OmniForgeRelease -Output C:\OmniForgeOut`
   This downloads `node-v24.19.0-win-x64.zip` and `SHASUMS256.txt` from https://nodejs.org/dist/v24.19.0/. It verifies the zip against that file and against the hash pinned in the script (`57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73`, read on 2026-09-26). It then copies `run-in-sandbox.ps1` into the release folder and writes `C:\OmniForgeOut\omniforge-install.wsb`.
4. Open `C:\OmniForgeOut\omniforge-install.wsb`. The sandbox has no network. It maps the release folder read-only and the output folder writable. At logon it runs `run-in-sandbox.ps1`, which uses the verified portable Node and then runs install, doctor, repair, start, the probe (`GET /` and `/api/state` with the printed token, `/api/state` without it, `/api/skills`), a stdin-EOF stop, the triage uninstall and `uninstall --apply --remove-data`.
5. Read `C:\OmniForgeOut\report.json`: `passed`, `doctorOk`, each step's exit code and output (token redacted), the probe status codes, `lockLeft` and `residue`. Then close the sandbox, which discards it.

Expected in a stock sandbox: the doctor `python` row is `missing` (no Python ships with Windows), so `install` and `doctor` exit 1 with the winget line. `/api/skills` then answers 503, and `doctorOk` is false. `passed` covers the lifecycle only: install, verified files, launch, authenticated probe, token refusal, clean stop, uninstall and an empty prefix. A fully green doctor needs Python installed in the sandbox first, and that step is not automated.

The run ends with `uninstall --apply --remove-data`. `-Prefix` therefore defaults to a fresh `%TEMP%\omniforge-acceptance-<guid>`, and the script refuses any prefix that already exists before it installs anything. A relative `-Prefix` is resolved once, against the PowerShell location, and that absolute path is used by the guard, the report and every step. The script also stops when `install` does not print `Installed OmniForge`. A real install, such as `%LOCALAPPDATA%\OmniForge`, is therefore never reused. If the Lab does not print its URL within `-StartTimeoutSeconds` (default 90) or does not stop within 60 s, the script ends the whole process tree with `taskkill /T /F`, not only `cmd.exe`. When it unpacked the portable Node into `%TEMP%\omniforge-portable-node`, `report.json` lists that folder under `residue`; the script never deletes it. The same script ran on the development host for the evidence below.

## Known limits

- Unsigned zip, integrity by sha256 only; no MSI, Start-menu entry, auto-update channel or code signing.
- x64 Windows only. node-pty is bundled exactly as `npm ci` installs it: 27 MB unpacked, of which the unused `win32-arm64` prebuild is 12 MB (measured 2026-09-26). Pruning it would make the bundle differ from a lockfile install, so it stays.
- Python, Git and the host CLIs are declared and checked, not provisioned.
- A clean-user or VM run is still pending (above). The host smoke is not that gate.

## Evidence

### Review repairs at `3129bfc`

Host run on 2026-09-26, source **`3129bfcc01646defef796a240da05f3759c82e0c`** (branch `claude/installer`), same host and toolchain as below. Every prefix was a fresh `%TEMP%` folder; `%LOCALAPPDATA%\OmniForge` and the owner's `.omniforge-lab` data were not touched. This is the development host, **not** the clean-user gate.

Tests at that SHA: `node --test omniforge-lab/test/manage.test.mjs` 12/12, including 4 new regression tests and an extended update test (5 failed before the fix). `npm --prefix omniforge-lab test` 167/167 and `python -m unittest discover tests` 303 OK, all with 0 skipped.

```text
> scripts\omniforge.cmd pack --out %TEMP%\ofs-3129bfc\release
Built C:\Users\Yeonatan\AppData\Local\Temp\ofs-3129bfc\release\omniforge-0.1.0-3129bfc-win-x64.zip (305 files)
sha256 4678a68ec5e1766b349b425257fbca4673d6845eac26b7aed843fc2098e3f10b
> powershell -File scripts\sandbox\prepare-release.ps1 -Release %TEMP%\ofs-3129bfc\release -Output %TEMP%\ofs-3129bfc\out
Verified node-v24.19.0-win-x64.zip sha256 57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73

> run-in-sandbox.ps1 -Release ... -Output ...\out-refuse -Prefix %TEMP%\ofs-3129bfc\Existing     (holds data\state.json)
ERROR: ...\ofs-3129bfc\Existing already exists; this run ends with uninstall --apply --remove-data, so pass a -Prefix that does not exist yet
(exit 1, no step ran, state.json unchanged)

> run-in-sandbox.ps1 -Release ... -Output ...\out -PortableNode                                  (no -Prefix)
== install (exit 0)
Installed OmniForge 0.1.0-3129bfc in C:\Users\Yeonatan\AppData\Local\Temp\omniforge-acceptance-6fb7433e8ea04aa3b2f94a577b620731 (data: ...\data)
== doctor (exit 0) / == repair (exit 0) All 305 files of 0.1.0-3129bfc match the build manifest.
start --stop-on-eof           OmniForge Lab: http://127.0.0.1:64503/?token=<redacted>
== uninstall (exit 0) / == uninstall --apply --remove-data (exit 0)
Report: ...\ofs-3129bfc\out\report.json (passed: True)
```

`report.json`: `passed: true`, `doctorOk: true`, portable Node v24.19.0 verified against SHASUMS256.txt. The probe returned `GET /` 200 (the Lab page), `GET /api/state` 200 with the token (0 projects, 9 skills), 403 without it and `/api/skills` 200. The stdin-EOF stop exited 0 with no `state.lock` left, and `prefixLeft: false`. The run took 16 s. Residue: nothing under the prefix; 13 older `%TEMP%\omniforge-demo-*` folders listed for triage and left in place.

Update and rollback between two real builds (`ab7195f` installed by its own manager, then `3129bfc`). `state.json` held hand-written markers, not Lab state; the Lab was not started in this run:

```text
> bootB update --from omniforge-0.1.0-3129bfc-win-x64.zip --prefix ...        (exit 0)
State backup: ...\data\state.json.pre-0.1.0-3129bfc
> omniforge rollback                                                          (exit 0)
State from before 0.1.0-3129bfc: ...\data\state.json.pre-0.1.0-3129bfc (restore it by hand only if ...)
state.json rewritten as {"marker":"after-rollback"}
> bootB update ... (again)                                                    (exit 0)
State backup: ...\data\state.json.pre-0.1.0-3129bfc.1
> omniforge rollback (again)                                                  (exit 0)
State from before 0.1.0-3129bfc: ...\data\state.json.pre-0.1.0-3129bfc.1 (restore it by hand only if ...)
state.json.pre-0.1.0-3129bfc: {"marker":"first"}
state.json.pre-0.1.0-3129bfc.1: {"marker":"after-rollback"}
> bootB uninstall --apply --remove-data --prefix ...                          (exit 0)
prefix exists after uninstall: False
```

Prefix casing and a reinstall over kept data, through the `3129bfc` manager:

```text
> uninstall --apply --prefix c:\users\yeonatan\appdata\local\temp\ofs-3129bfc\case\omniforge
7. C:\...\case\OmniForge\data: user data, removed only with --remove-data; 1 entries, the Lab's OMNIFORGE_DATA_DIR
1. c:\...\case\omniforge\data: user data kept (no --remove-data); left in place                 (residue, exit 0)
state.json after: {"marker":"keep-me"}
> install again, then uninstall --apply --remove-data --prefix c:\...\case\omniforge
6. C:\...\case\OmniForge\data: user data, removed only with --remove-data; 1 entries, the Lab's OMNIFORGE_DATA_DIR
1. c:\...\case\omniforge: empty folder not recorded as created by install, or in use; left in place   (residue, exit 0)
```

**Defects fixed in `3129bfc`** (from review, each reproduced by a failing test first):

1. `uninstall --apply` compared paths case-sensitively. With a differently cased `--prefix`, it did not recognise `data\` and deleted it recursively without `--remove-data`. The fixed manager compares paths through `path.relative`, which ignores case on Windows.
2. A reinstall over data kept by `uninstall --apply` did not record `data\`, so a later `--remove-data` silently kept it. Every install now records it. The residue label now reflects the flag, and an empty prefix left behind is listed.
3. `rollback` named `state.json.pre-<version>`, the oldest backup, not the one taken before the update being undone. `update` now records its backup in `current.json`, and `rollback` names exactly that file.
4. `run-in-sandbox.ps1` defaulted `-Prefix` to `%LOCALAPPDATA%\OmniForge`, did not gate on the install result and ended with `uninstall --apply --remove-data`. It now defaults to a fresh `%TEMP%` folder, refuses an existing prefix and stops unless install printed `Installed OmniForge`.

### First host run at `ab7195f`

Host run on 2026-09-26, source **`ab7195fbc9965e25561109186f7311fc5851fc6b`** (branch `claude/installer`). Host: Windows 11 Pro 10.0.26200, Windows PowerShell 5.1.26100.9444, Node v24.19.0 and the bundled Codex Python 3.12. Every prefix was a disposable `%TEMP%` folder; `%LOCALAPPDATA%\OmniForge` and the owner's `.omniforge-lab` data were not touched. This is the development host, **not** the clean-user gate.

Tests at that SHA: `node --test omniforge-lab/test/manage.test.mjs` 8/8, and `npm --prefix omniforge-lab test` 163/163 with 0 skipped.

**Build.**

```text
> scripts\omniforge.cmd pack --out %TEMP%\ofs-ab7195f\release
Built C:\Users\Yeonatan\AppData\Local\Temp\ofs-ab7195f\release\omniforge-0.1.0-ab7195f-win-x64.zip (305 files)
sha256 83d953401dd01f84a52eab7219de3519ba34b8df21c563094b66b5629d95741d
> powershell -File scripts\sandbox\prepare-release.ps1 -Release %TEMP%\ofs-ab7195f\release -Output %TEMP%\ofs-ab7195f\out
Verified node-v24.19.0-win-x64.zip sha256 57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73
```

The zip is 8,942,467 bytes. It holds `.agents`, `docs`, `harness`, `LICENSE`, `omniforge-build.json`, `omniforge-lab` (no `test/`) and `scripts/omniforge.cmd` (CRLF kept).

**Lifecycle.** This is the sandbox script with the verified portable Node:

```text
> powershell -File %TEMP%\ofs-ab7195f\release\run-in-sandbox.ps1 -Release %TEMP%\ofs-ab7195f\release -Output %TEMP%\ofs-ab7195f\out -Prefix %TEMP%\ofs-ab7195f\OmniForge -PortableNode
== install (exit 0)
Installed OmniForge 0.1.0-ab7195f in C:\Users\Yeonatan\AppData\Local\Temp\ofs-ab7195f\OmniForge (data: ...\OmniForge\data)
ok       node   Node.js 24.19.0
ok       lab    node-pty 1.2.0-beta.15; terminal shell C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe
ok       python Python 3.12 at C:\Users\Yeonatan\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe (via bundled Codex runtime)
ok       git    git version 2.54.0.windows.1 (optional)
ok       claude logged in: API key (ANTHROPIC_API_KEY; signed in via claude.ai) (optional)
missing  codex  codex CLI not found (optional)
         -> install it (npm install -g @openai/codex), then run: codex login
Doctor: required prerequisites are ready.
== doctor (exit 0)            (same rows)
== repair (exit 0)            All 305 files of 0.1.0-ab7195f match the build manifest. / No stale locks.
start --stop-on-eof           OmniForge Lab: http://127.0.0.1:56129/?token=<redacted>
== uninstall (exit 0)         10 numbered triage lines, "Nothing removed."
== uninstall --apply --remove-data (exit 0)
```

`report.json`: `passed: true`, `doctorOk: true`. The probe of the installed Lab returned `GET /` 200 (the Lab page) and `GET /api/state` 200 with `X-OmniForge-Token` (0 projects, 9 skills). The same call without the token returned 403, and the Python-backed `GET /api/skills?ring=installed&limit=5` returned 200. Closing stdin stopped it with exit 0, and `state.lock` was gone. After the uninstall `prefixLeft: false`. The whole run took 12.3 s. Residue: nothing under the prefix, and 9 older `%TEMP%\omniforge-demo-*` folders listed for triage and left in place.

**Update, rollback and repair between two real builds** (`c7acb0d` installed, then `ab7195f`), in a fresh `%TEMP%\ofs-update\OmniForge`. Doctor rows and the numbered lists are left out:

```text
> boot\scripts\omniforge.cmd install --from omniforge-0.1.0-c7acb0d-win-x64.zip --prefix ...    (exit 0)
Lab A running; POST /api/projects created 'update-smoke'
> bootB\scripts\omniforge.cmd update --from omniforge-0.1.0-ab7195f-win-x64.zip --prefix ...   (while Lab A runs)
omniforge: OmniForge is running or its data lock is uncertain (pid 53216 holds state.lock); stop it first   (exit 1)
stop via stdin EOF: exit=0 state.lock left=False
> bootB\...\omniforge.cmd update ...                                                          (exit 0)
State backup: ...\data\state.json.pre-0.1.0-ab7195f
Updated 0.1.0-c7acb0d -> 0.1.0-ab7195f; 0.1.0-c7acb0d stays installed side by side.
To go back: "...\OmniForge\omniforge.cmd" rollback
Lab B /api/state projects: update-smoke
> omniforge rollback                                                                          (exit 0)
Switched back to 0.1.0-c7acb0d; 0.1.0-ab7195f stays installed.
Lab A again; POST /api/projects created 'after-rollback'
> bootB\...\omniforge.cmd update ...   (again)                                                (exit 0)
State backup: ...\data\state.json.pre-0.1.0-ab7195f.1
state.json.pre-0.1.0-ab7195f: projects = update-smoke
state.json.pre-0.1.0-ab7195f.1: projects = update-smoke, after-rollback
tampered: appended to index.html, deleted workflows.mjs
> omniforge repair                                                                            (exit 0)
Restored 2 file(s) of 0.1.0-ab7195f from ...\releases\omniforge-0.1.0-ab7195f-win-x64.zip: omniforge-lab/index.html, omniforge-lab/workflows.mjs
> omniforge repair   (again)                                                                  (exit 0)
All 305 files of 0.1.0-ab7195f match the build manifest.
> omniforge uninstall --apply --remove-data                                                   (exit 0)
prefix exists after uninstall: False
```

**Installed demo, joint PTY shutdown** (`ab7195f`). `start --demo --stop-on-eof` printed `OmniForge Demo: http://127.0.0.1:61134/?token=<redacted>`, and `/api/state` showed 2 projects and sessions `Build:running, Pesquisa:running`. Closing stdin ended both shells and the server with exit 0 within 30 s, and no "Microsoft Visual C++ Runtime Library" window was open afterwards. That joint exit raised the node-pty 1.1.0 assert. The demo's own `%TEMP%\omniforge-demo-*` folder, which this run created, was removed after the check.

**Defects these runs found, all fixed before `ab7195f`:**

1. `b2819a0`: `uninstall --apply` removed everything but exited 1 and printed "O sistema não pode encontrar o caminho especificado" twice. cmd re-reads a running batch after every external command. Fixed in `c7acb0d` with `(goto) 2>nul`, plus a regression test through the real installed launcher.
2. `b2819a0`: the residue report labelled other runs' `omniforge-demo-*.log` files as demo data. Fixed in `c7acb0d`: it now lists folders only.
3. `c7acb0d`: a second update after a rollback reused the first `state.json.pre-<version>`, so newer work had no backup. Fixed in `ab7195f`: it writes `.pre-<version>.<n>` and never overwrites. The run also showed that the manager you invoke performs the update: through the rolled-back launcher, the old `c7acb0d` manager still reused the backup. The recommended update command above is therefore the new release's manager.

**Not covered here.** A clean Windows user or VM (the Windows Sandbox run is pending the owner enabling the feature). Doctor's logged-out and subscription classes, and a Store-alias-only Python, are covered by unit tests only: this host has `claude` signed in with an `ANTHROPIC_API_KEY` source, no `codex` CLI and the bundled Python. Interactive Ctrl+C was not exercised by an agent.
