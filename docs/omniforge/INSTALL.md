# OmniForge on Windows: install, launch, update, recover, remove

Status: **V1 hard gate 1 tooling, 2026-09-26.** Pack, install, start, update, rollback, repair and uninstall are implemented in `omniforge-lab/manage.mjs` and covered by `omniforge-lab/test/manage.test.mjs`. A real smoke on the development host is recorded under [Evidence](#evidence). The clean-user run in Windows Sandbox is **pending**: the feature is not enabled on the owner's machine yet (see [Windows Sandbox](#windows-sandbox-clean-user-run)). This is not a signed installer, an MSI or a release certificate.

Every command goes through `scripts\omniforge.cmd <command>`, which runs `node omniforge-lab\manage.mjs <command>`. It works from a source checkout, from an extracted release zip and from an install.

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

The default prefix is `%LOCALAPPDATA%\OmniForge`; `--prefix <dir>` changes it. `install` verifies the `.sha256` and extracts into a temporary folder. It checks every file against the manifest before moving the folder into place, then runs doctor. Installing the same zip again changes nothing. A different version must go through `update`.

| Path under the prefix | What it is |
|---|---|
| `app\<version>-<shortsha>\` | one folder per installed version, side by side |
| `releases\<zip>` and `.sha256` | verified copy used by `repair` |
| `data\` | Lab state (`OMNIFORGE_DATA_DIR`), kept outside every app folder |
| `current.json` | active version and the previous one |
| `install.json` | every path the install created, with its kind |
| `omniforge.cmd` | launcher that forwards to the active version |

## Launch

```powershell
& "$env:LOCALAPPDATA\OmniForge\omniforge.cmd" start          # prints: OmniForge Lab: http://127.0.0.1:<port>/?token=<token>
& "$env:LOCALAPPDATA\OmniForge\omniforge.cmd" start --demo   # disposable synthetic demo in %TEMP%\omniforge-demo-*
```

Open the exact printed URL. Opening `index.html` as a file does not work. `OMNIFORGE_PORT` fixes the port; the default is a random free port. Ctrl+C closes the sessions and the server, which releases `data\state.lock`. `start --stop-on-eof` also stops when its standard input closes. Supervisors and the acceptance script use that, because Windows cannot deliver Ctrl+C to a process that does not share a console with the sender.

## Update and roll back

```powershell
& "$env:LOCALAPPDATA\OmniForge\omniforge.cmd" update --from .\omniforge-0.2.0-<sha>-win-x64.zip
& "$env:LOCALAPPDATA\OmniForge\omniforge.cmd" rollback
```

`update` refuses while a running Lab holds `data\state.lock`. It uses the Lab's own lock semantics read-only: a live pid, an unreadable lock or a `state.recovery.lock` all count as running. It copies `data\state.json` to `state.json.pre-<new version>` and never overwrites a backup: an update after a rollback that finds different content writes `state.json.pre-<new version>.1`, `.2` and so on. It then installs the new version next to the old one, switches `current.json` and the launcher, runs doctor and prints the rollback command. `rollback` switches back to the previous version and points to that backup. It never overwrites data by itself.

## Repair

`repair` hashes every file of the active version against the build manifest. If any file differs or is missing, it re-verifies the recorded zip under `releases\` and restores only those files. Files outside the manifest are ignored, for example the `harness\__pycache__` that Python writes when the catalog runs; uninstall removes them with the app folder. It then lists stale lock files for triage: a `state.lock` whose pid is gone, preserved `state.lock.stale-*` files and a leftover `state.recovery.lock`. It never deletes them.

## Uninstall

```powershell
& "$env:LOCALAPPDATA\OmniForge\omniforge.cmd" uninstall                            # triage list only
& "$env:LOCALAPPDATA\OmniForge\omniforge.cmd" uninstall --apply                    # remove recorded paths, keep data
& "$env:LOCALAPPDATA\OmniForge\omniforge.cmd" uninstall --apply --remove-data      # also remove data\
```

Without `--apply`, uninstall prints the numbered list `N. <path>: <reason>; <evidence>` and removes nothing. `--apply` refuses while the Lab is running. It removes only paths that `install.json` records inside the prefix. Folders are removed only when empty, and `data\` only with `--remove-data`. It then rescans and prints a residue report. `%TEMP%\omniforge-demo-*` folders from past demos are listed for triage and never deleted. Node.js, Python, Git and the host CLIs are never touched.

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

The same script ran on the development host against a disposable prefix for the evidence below. Pass `-Prefix` there, or it installs into your real `%LOCALAPPDATA%\OmniForge`.

## Known limits

- Unsigned zip, integrity by sha256 only; no MSI, Start-menu entry, auto-update channel or code signing.
- x64 Windows only. node-pty is bundled exactly as `npm ci` installs it: 27 MB unpacked, of which the unused `win32-arm64` prebuild is 12 MB (measured 2026-09-26). Pruning it would make the bundle differ from a lockfile install, so it stays.
- Python, Git and the host CLIs are declared and checked, not provisioned.
- A clean-user or VM run is still pending (above). The host smoke is not that gate.

## Evidence

Pending: the host smoke of this build is recorded in the next commit.
