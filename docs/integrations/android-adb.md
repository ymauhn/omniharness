# Android device control (adb and scrcpy)

## What it is
`adb` (Android Debug Bridge, part of the SDK Platform-Tools) talks to an Android device over USB or TCP: it lists devices, reads the screen, dumps the view hierarchy as XML and injects taps, swipes, text and key events. `scrcpy` mirrors and records the same device without installing anything permanent on it. Together they are the harness's "Playwright for a phone": a queryable tree, locators over it, actions, assertions and a trace.

### How to read the source markers
Every command below carries a marker, because "never state a command from memory" is only auditable if each line says where it came from:

| Marker | Means |
|---|---|
| **G** | An official Google page was opened and contains it |
| **A** | AOSP source, read through a GitHub mirror of `android.googlesource.com` |
| **F** | A ROM fork of AOSP (GrapheneOS, LineageOS) — the code is real, the device in front of you may differ |
| **U** | Unverified: no page opened confirms it. Do not ship it as fact |

**Global sourcing caveat.** `android.googlesource.com` and `cs.android.com` are egress-blocked from the environment this page was researched in (`{"error_type":"EGRESS_BLOCKED"}`). **Not one AOSP fact on this page was read from Google-hosted source.** Every **A** and **F** line comes from a third-party mirror. Mirror refs are branch names (`main`, `master`, a fork's release branch), not pinned commits, so an **A** or **F** line is not a claim about any named Android version. Where Google's own page and AOSP source disagree, both are given.

## When to reach for it
Try first: the model's own vision on a screenshot when you only need to *see* the screen. Reach for adb when the task needs the view hierarchy (a locator, an assertion) or an action on the device. Reach for scrcpy when you need a recording longer than `screenrecord` allows, or audio. Routing row: "Record a screen, or drive an Android phone".

Not for iOS: without macOS and Xcode there is no WebDriverAgent, and mirroring without control is not device automation. Roadmap row, `not shipped`.

## Cost and keys
Both are free. adb ships in SDK Platform-Tools under the **Android Software Development Kit License Agreement** ("In order to use the SDK, you must first agree to the License Agreement", G, https://developer.android.com/studio/terms); the download page requires ticking acceptance. scrcpy is **Apache-2.0** (A, the repository's `LICENSE` opens "Apache License / Version 2.0, January 2004").

No API key, no account, no credits. The credential-shaped thing here is the device itself: **a human must physically unlock the handset and accept the RSA dialog.** G, https://developer.android.com/tools/adb — "This security mechanism protects user devices because it ensures that USB debugging and other adb commands cannot be executed unless you're able to unlock the device and acknowledge the dialog." (Android 4.2.2 / API 17 and higher.) The agent never accepts that dialog; it waits.

## Network and the gate
adb over USB reaches no network. `adb connect` does. The real risk is not bandwidth, it is **irreversible action on the device** and **terms-of-service exposure when driving someone else's app**.

| Surface | Rule | Pattern |
|---|---|---|
| Device reads: `adb devices`, `uiautomator dump`, `screencap`, `screenrecord`, `getprop` | free, never asks | — |
| A flow on `route: app` (taps, text, swipes on your own app) | **one yes per flow**, naming the package and step count | AGENTS.md HITL list (runs inside Python) |
| A flow on `route: social` | asks **every run**, printing the terms-of-service and account-risk warning | AGENTS.md HITL list |
| `adb install`, `adb uninstall`, `adb connect`, `adb root` | asks every time | `"Bash(adb install:*)"`, `"Bash(adb uninstall:*)"`, `"Bash(adb connect:*)"`, `"Bash(adb root:*)"` |
| `scrcpy` | asks | `"Bash(scrcpy:*)"` |

**Hard blocks** for `harness/guard_bash.py` — every one of these is a verified command, not a guess:

| Command | Marker | Source |
|---|---|---|
| `adb shell pm uninstall <package>` | G | https://developer.android.com/tools/adb |
| `adb shell pm clear <package>` | G | https://developer.android.com/tools/adb |
| `adb shell pm remove-user <user_id>` | G | https://developer.android.com/tools/adb |
| `adb shell rm -r` / `-R` / `-rf` | A | toybox `usage: rm [-fiRrv] FILE...`; Android maps `rm` to toybox ("Since Marshmallow almost everything is supplied by toybox instead", https://raw.githubusercontent.com/aosp-mirror/platform_system_core/master/shell_and_utilities/README.md) |
| `adb reboot bootloader\|recovery\|sideload` | A | `adb.1.md`, https://raw.githubusercontent.com/mirror/platform_packages_modules_adb/main/docs/user/adb.1.md |
| `adb disable-verity`, `adb remount` | A | same man page |

**Correction to the Phase C spec:** `--wipe-data` is **not an adb flag**. It is an emulator option — `emulator @<avd_name> -wipe-data` (G, https://developer.android.com/studio/run/emulator-commandline). The spec listed it under adb hard blocks; that row is wrong and is replaced by the table above.

## Install
Neither tool is on the reference machine (`docs/PHASE0_AUDIT.md`, 2026-09-10). Both installs are gated.

**SDK Platform-Tools** (contains adb; Android Studio is *not* required) — G, https://developer.android.com/tools/releases/platform-tools:
```
https://dl.google.com/android/repository/platform-tools-latest-windows.zip
https://dl.google.com/android/repository/platform-tools-latest-linux.zip
https://dl.google.com/android/repository/platform-tools-latest-darwin.zip
```
Unzip and put the `platform-tools` directory on PATH. Accepting the licence is a checkbox on the download page.

**Linux, so a non-root user can see the device** — G, https://developer.android.com/studio/run/device: "Each user that wants to use ADB needs to be in the `plugdev` group."
```
sudo usermod -aG plugdev $LOGNAME
apt-get install android-sdk-platform-tools-common     # udev rules; documented under the "Ubuntu Linux" heading
```
Groups only update on login, so log out and back in.

**Windows** additionally wants OEM USB drivers. That page (`developer.android.com/studio/run/oem-usb`) was named in the research but **never opened** — treat the Windows driver step as **U** until someone reads it.

**scrcpy** — current release v4.1 (A, `doc/windows.md`, `doc/linux.md`):
```
winget install --exact Genymobile.scrcpy    # Windows; "ADB and other dependencies will be installed alongside scrcpy"
choco install scrcpy                        # then also: choco install adb
scoop install scrcpy                        # then also: scoop install adb
```
or the release archives `scrcpy-win64-v4.1.zip` / `scrcpy-linux-x86_64-v4.1.tar.gz`. The **Windows release zip bundles `adb.exe`** (A, `FAQ.md`, section "`adb` not found"). On Linux, distribution packages (`pacman -S scrcpy`, and the `apt`/`snap` entries the project marks obsolete) or a source build via `./install_release.sh`.

scrcpy needs adb: "`scrcpy` execute `adb` commands to initialize the connection with the device. If `adb` fails, then scrcpy will not work." (A, `FAQ.md`) — override with `export ADB=/path/to/your/adb`. The device needs **API 21 / Android 5.0** and USB debugging on (A, `README.md`).

## Activate in OmniHarness
Routing row "Record a screen, or drive an Android phone": `device-lab`. The command surface below is what `device-lab` wraps.

### Devices and connection

| Command | Marker | Note |
|---|---|---|
| `adb devices` | G | prints `List of devices attached` then one row per device |
| — documented states: `offline`, `device`, `no device` | G | **the word `unauthorized` does not appear on Google's adb page** |
| — `unauthorized` is nonetheless a real state | A | `case kCsUnauthorized: return "unauthorized";` in `adb.cpp`. Same switch also yields `offline`, `bootloader`, `device`, `host`, `recovery`, `rescue`, `sideload` |
| `adb pull remote local` | G | |
| `adb pair ipaddr:port` (modern) / `adb tcpip 5555` then `adb connect HOST[:PORT]` (legacy) | G / A | wireless debugging |

### Reading the screen

| Command | Marker | Note |
|---|---|---|
| `adb exec-out screencap -p > screen.png` | G | quoted with the redirect: "# use 'exec-out' instead of 'shell' to get raw data". The redirect is part of the documented form |
| `adb shell screencap /sdcard/screen.png` then `adb pull` | G | the on-device form takes **no `-p`**. `screencap -p /sdcard/x.png` appears on no page |
| `adb shell screenrecord /sdcard/demo.mp4` | G | minimum Android 4.4 / API 19; excluded on Wear OS |

`exec-out` gives **unmangled binary stdout** — no shell-protocol framing, no CRLF translation. Do **not** describe it as a PTY: `docs/dev/services.md` prose says "raw PTY", but `daemon/services.cpp` dispatches `SubprocessType::kRaw` with `SubprocessProtocol::kNone` and `shell_service.cpp` allocates a socketpair for that path. Prose and code disagree; the behaviour that matters (binary-safe stdout) is what Google's page supports.

**`screenrecord` limits** — the numbers that constrain a capture skill:

| Fact | Marker | Source |
|---|---|---|
| "Audio is not recorded with the video file." | G | https://developer.android.com/tools/adb |
| `--time-limit time`: "The default and maximum value is 180 (3 minutes)." | G | same page — 180 is presented as **both** default and ceiling |
| 180 is the **default only**; `--time-limit 0` removes the limit | F | `static const uint32_t kMaxTimeLimitSec = 180;` used as `gTimeLimitSec` default, with `--time-limit 0` mapped to `UINT32_MAX` — GrapheneOS and LineageOS forks of `frameworks/av` |
| `--size widthxheight`, default the device's native resolution (or 1280x720) | G | pin it: "Some devices might not be able to record at their native display resolution." |
| `--bit-rate`, prose says default 20Mbps | G | the page's own example is `--bit-rate 6000000` described as 6Mbps — **Google's page is internally inconsistent about the unit** |
| Rotation during recording is not supported | G | "If the screen does rotate during recording, some of the screen is cut off" |
| Google documents six flags: `--help --size --bit-rate --time-limit --rotate --verbose` | G | |
| AOSP forks carry 17, including the real `--bugreport`, `--display-id`, `--output-format` | F | do not present these as Google-documented |

The two `--time-limit` readings are left standing side by side on purpose. Google's hosting is unreachable here, so the fork source could not be checked against Google's own copy. **Settle it on the device** (see "Verify it works").

### The view hierarchy

Google documents **no** `uiautomator` shell tool: the string `uiautomator` does not appear on `developer.android.com/tools/adb`, and the modern testing pages document the `androidx.test.uiautomator` *library* and the `uiautomatorviewer` GUI, not a dump command. Everything here is **A**, from `cmds/uiautomator/` in the `aosp-mirror/platform_frameworks_base` mirror.

```
adb shell uiautomator dump                      # writes /sdcard/window_dump.xml
adb shell uiautomator dump /sdcard/out.xml      # positional file argument
adb pull /sdcard/window_dump.xml
```
- Default path: `DEFAULT_DUMP_FILE = new File(Environment.getLegacyExternalStorageDirectory(), "window_dump.xml")`.
- Positional argument: `else if (!arg.startsWith("-")) { dumpFile = new File(arg); }`.
- The only real flag on `main` is `--compressed`. The `[--verbose]` in the tool's help string is a stale artifact; do not rely on it.

**`adb exec-out uiautomator dump /dev/tty` is UNVERIFIED and probably broken (U).** No page documents it. `AccessibilityNodeInfoDumper` opens its target with `new FileWriter(dumpFile)` — a plain file writer with no stdout or tty branch — and `exec-out` gives a socketpair, not a terminal. Combined with the status-line behaviour below, the likely outcome is the status line with **no XML**. It stays unverified in both directions; use the documented two-step form.

**Three traps a parser must handle:**

1. **The success line is misspelled in AOSP.** `System.out.println(String.format("UI hierchary dumped to: %s", ...))` — *hierchary*, not *hierarchy*. A parser matching the correct spelling will never strip it. Corroborated by two independent field transcripts.
2. **The success line lies.** `AccessibilityNodeInfoDumper` catches the write failure (`catch (IOException e) { Log.e(...) }`) while `DumpCommand` prints the line unconditionally; `dumpWindowToFile` also begins `if (root == null) { return; }`. The line's presence is **not** a success signal — the only reliable check is that the retrieved text parses as XML.
3. **A dump during animation fails, it does not go stale.** `uiAutomation.waitForIdle(1000, 1000 * 10)` and, on timeout, `System.err.println("ERROR: could not get idle state."); return;`.

XML shape, all confirmed verbatim in `AccessibilityNodeInfoDumper.java`:
- Root `<hierarchy rotation="N">`, document encoding UTF-8.
- Attributes, with exactly this spelling: `index`, `text`, `resource-id`, `class`, `package`, `content-desc`, `checkable`, `checked`, `clickable`, `enabled`, `focusable`, `focused`, `scrollable`, `long-clickable`, `password`, `selected`, `bounds`. The hyphenated ones are hyphenated.
- `bounds="[left,top][right,bottom]"` — the literal form comes from `Rect.toShortString()`.
- **Invisible children are skipped** (`if (child.isVisibleToUser())`), so a missing element does not mean it is absent — it may be off-screen. And `index` is the loop counter over *all* children including the skipped ones, so **indices in the dumped XML are not contiguous**.

### Acting on the device

All **A**, from `InputShellCommand.java` and friends, except the quoting rule.

```
adb shell input [<source>] [-d DISPLAY_ID] <command> [<arg>...]
adb shell input tap <x> <y>
adb shell input swipe <x1> <y1> <x2> <y2> [duration(ms)]      # default 300 ms
adb shell input text <string>
adb shell input keyevent [--longpress|--duration <ms>] [--doubletap] [--async] [--delay <ms>] <key code number or name> ...
adb shell am start -n com.example.app/.ExampleActivity
```
- `swipe`'s duration is optional and defaults to **300 ms** (`if (duration < 0) { duration = 300; }`). 300 ms is fast enough that some apps read it as a fling.
- `keyevent` takes a **number or a name**, and accepts several in one call (the trailing `...`). Numeric values from `KeyEvent.java`: `KEYCODE_HOME = 3`, `KEYCODE_BACK = 4`, `KEYCODE_TAB = 61`, `KEYCODE_ENTER = 66`. Cite the source file, not `developer.android.com/reference/android/view/KeyEvent` — that page is JS-rendered and returns only navigation chrome to a fetcher.
- **`input text` uses `%s` for a space**: the parser turns `%s` into `' '`. A string that legitimately contains the literal `%s` will lose it. A bare `%` passes through.
- **Quote twice.** G, https://developer.android.com/tools/adb: "To make the command work, quote twice, once for the local shell and once for the remote shell, as you do with `ssh(1)`." Example given: `adb shell setprop key "'two words'"`.
- Non-ASCII in `input text` is bounded by the virtual key-character map (`frameworks/base/data/keyboards/Virtual.kcm`), which does include accented Latin characters such as ç. "Non-ASCII fails" is too strong; "characters outside that map fail" is the accurate rule.
- `am start -n`: a class name starting with `.` is expanded to `package + class` by `ComponentName.unflattenFromString()`, so `com.example.app/.MainActivity` and the fully-qualified form are equivalent.

### Mirroring and long recordings (scrcpy)

All **A**, from the project's own `doc/` and man page.
```
scrcpy --record=file.mp4
scrcpy --no-playback --no-control --record=file.mp4      # the documented recording line
scrcpy --record=file.mkv --time-limit=20                 # seconds
scrcpy --no-audio --record=file.mp4                      # video only
scrcpy --record=file --record-format=mkv
```
- Containers: `.mp4 .m4a .aac .mkv .mka .opus .flac .wav`.
- `--no-playback` was **renamed from `--no-display` in v2.1**: "The option `-N`, initially `--no-display`, has been renamed to `--no-playback`, since it impacts both video and audio." It is an alias for `--no-video-playback` plus `--no-audio-playback`. On v4.1, `--no-display` is gone entirely.
- **scrcpy has no built-in length cap** — verified by absence across `doc/recording.md` and the man page. `--time-limit` is how you impose one. This is the reason to prefer scrcpy over `screenrecord` for anything long.
- Audio: "Audio forwarding is supported for devices with Android 11 or higher, and it is enabled by default." Android 12+ works out of the box; **Android 11 needs the screen unlocked when scrcpy starts**; "For **Android 10 or earlier**, audio cannot be captured and is automatically disabled."

## Verify it works
```
adb devices
scrcpy --version
```
`adb devices` prints `List of devices attached` and one row per device. `scrcpy --version` (or `-v`) prints the version — A, `app/scrcpy.1`, "Print the version of scrcpy."

**`adb --version` is not side-effect-free**: the adb client starts the adb server daemon on first contact. `adb devices` has the same effect and at least tells you something useful, so prefer it. Google's adb page documents no `--version` at all; the flag appears only in the platform-tools revision history.

Two things this page could not settle and that one minute with a real device would:
```
adb shell screenrecord --help                       # does this build cap --time-limit at 180, or default to it?
adb shell uiautomator dump /sdcard/window_dump.xml  # confirm the misspelled status line on your build
adb shell getprop ro.build.fingerprint              # record which build you observed it on
```
Paste the literal output into `docs/scout/screen-and-clone/spec.md` as an **observation** with the build fingerprint beside it — an observation on a named build, not a citation.

## Uninstall
Delete the `platform-tools` directory and remove it from PATH; `adb kill-server` first so no daemon holds a handle. scrcpy: `winget uninstall Genymobile.scrcpy`, `choco uninstall scrcpy`, `scoop uninstall scrcpy`, the distribution's package manager, or delete the extracted archive. Neither tool leaves anything on the phone. The `plugdev` group membership and the udev package on Linux go on the owner's triage list, one line each — never removed on their behalf.

## License
SDK Platform-Tools: Android Software Development Kit License Agreement (https://developer.android.com/studio/terms), with open-source components carved out in its section 3.5. scrcpy: Apache-2.0. AOSP source quoted here: Apache-2.0.

## Source
https://developer.android.com/tools/adb · https://developer.android.com/tools/releases/platform-tools · https://developer.android.com/studio/run/device · https://developer.android.com/studio/terms · https://github.com/Genymobile/scrcpy · AOSP through the mirrors https://github.com/mirror/platform_packages_modules_adb and https://github.com/aosp-mirror/platform_frameworks_base (`android.googlesource.com` is egress-blocked from the research environment)

Verified on 2026-09-15.
