# ffmpeg: screen capture and video analysis

## What it is
The parts of ffmpeg that `device-lab` and `video-read` depend on: the desktop capture input devices (`gdigrab` on Windows, `x11grab` on X11, `ddagrab` as a filter source), and the analysis filters and options that turn a video into a shot list, a palette, an energy curve and a tail frame.

The assembly side of ffmpeg — concat, audio mix, burning subtitles — is already documented as a working recipe in `../../recipes/creative-video-higgsfield.md` step 7 and is not repeated here.

### How to read the source markers
| Marker | Means |
|---|---|
| **M** | Read from the FFmpeg manual's Texinfo source in the project repository |
| **C** | Read from FFmpeg's C source (the option table or the filter implementation) |
| **U** | Unverified: composed from documented pieces, but no page shows the whole command |

**Global sourcing caveat.** `ffmpeg.org` is egress-blocked from the environment this page was researched in — `https://ffmpeg.org/ffmpeg-devices.html`, `ffmpeg-filters.html` and `ffmpeg.html` all returned `{"error_type":"EGRESS_BLOCKED"}`, reproduced by two independent agents. Every **M** line was therefore read from `doc/*.texi` in https://github.com/FFmpeg/FFmpeg, which is the source those HTML pages are generated from. `doc/filters.texi` on `master` is about 960 KB and exceeds a fetcher's truncation window, so some filter sections were reachable only in older tags (`n1.0`, `n1.2`) where the file is small — those lines say so, and each was re-checked against `master` where the section could be reached.

## When to reach for it
ffmpeg is the default for anything that reads or writes a video file locally. Try it before any hosted video service, before a Python video library, and before Remotion or `video-db` (both catalog rows, not installed). Routing rows: "Record a screen, or drive an Android phone" (the desktop half) and "Read a reference video, or clone its style".

## Cost and keys
Free, no key, no network at use time. ffmpeg 9.0 is already on the reference machine (`README.md` of `docs/integrations/`, and `docs/PHASE0_AUDIT.md`). LGPL-2.1-or-later or GPL-2.0-or-later depending on the build's configure flags — check your own binary's first output line, do not assume.

## Network and the gate
None. ffmpeg reads and writes local files. There is **no gate entry and no HITL line for ffmpeg** — that is deliberate: a local, free, side-effect-scoped tool should not cost the owner a confirmation. The one thing that does ask is the install, if ffmpeg is ever absent, through the package-manager patterns already in `harness/settings.json`.

Two safety notes that are not about the gate but about the filesystem: ffmpeg overwrites its output only when given `-y`, and it *prompts* otherwise, which in a non-interactive agent context hangs. Pass `-y` deliberately, or `-n` to fail instead.

## Install
Present on the reference machine. Where absent, the distribution's package (`apt install ffmpeg`, `pacman -S ffmpeg`, `winget install ffmpeg`) — gated like every install. No model weights, no first-run download.

## Activate in OmniHarness

### Option placement

**M**, `doc/ffmpeg.texi`: input options go **before** the `-i` they apply to, output options after it and before the output file.
```
ffmpeg [input options] -i <input> [output options] <output>
```
Getting this wrong is the single most common reason a capture command silently ignores `-framerate` or `-video_size`.

`-vf` is an alias for `-filter:v` (**M**).

### Desktop capture on Windows: gdigrab

All **M**, `doc/indevs.texi`, with the manual's own examples:
```
ffmpeg -f gdigrab -framerate 6 -i desktop out.mpg
ffmpeg -f gdigrab -framerate 6 -i title=Calculator out.mpg
ffmpeg -f gdigrab -framerate 6 -offset_x 10 -offset_y 20 -video_size 640x480 -i desktop out.mpg
ffmpeg -f gdigrab -show_region 1 -framerate 6 -video_size cif -offset_x 10 -offset_y 20 -i desktop out.mpg
```
- The window forms are `-i title=<window title>` and `-i hwnd=<window_hwnd>`.
- `-video_size` takes `<width>x<height>` **or** a size abbreviation (**M**, `doc/utils.texi`: "a string of the form `width`x`height`, or the name of a size abbreviation"). `vga` = 640x480, `cif` = 352x288. Both forms the Phase C spec used are valid.
- Omitting `-video_size` captures the full area.
- **The offset origin is the top-left of the *primary* monitor**, not of the virtual desktop: "If you have a monitor positioned to the left of your primary monitor, you will need to use a negative `offset_x` value to move the region to that monitor." Same for `offset_y` and a monitor above. Negative values are legal (**C**, the options are `AV_OPT_TYPE_INT` over `INT_MIN..INT_MAX`).
- `-show_region 1` draws a border around the captured region — useful for a human check, and it is itself visible in some compositing situations, so leave it off for a deliverable.

### Desktop capture on X11: x11grab

**M**, `doc/indevs.texi`:
```
ffmpeg -f x11grab -framerate 25 -video_size cif -i :0.0+10,20 out.mpg
ffmpeg -f x11grab -framerate 25 -video_size cif -i :0.0 out.mpg
```
Input name syntax: `[hostname]:display_number.screen_number[+x_offset,y_offset]` — plus sign, comma, no spaces, exactly as the Phase C spec wrote it. The hostname defaults to `localhost`, and `$DISPLAY` supplies the default display name. The device is registered in C as `ff_xcbgrab_demuxer` but is still selected with `-f x11grab` (**C**, `libavdevice/alldevices.c`).

### ddagrab is a filter source, not an input device

**M**/**C**, from the commit that introduced it and `libavfilter/vsrc_ddagrab.c`:
```
ffmpeg -f lavfi -i ddagrab -c:v h264_nvenc -cq 18 output.mp4
ffmpeg -filter_complex ddagrab=output_idx=1:framerate=60,hwdownload,format=bgr0 -c:v libx264 out.mp4
ffmpeg -filter_complex ddagrab=video_size=800x600:offset_x=100:offset_y=100 ...
```
It is Windows Desktop Duplication on Direct3D 11 and it keeps frames on the GPU, so a software encoder needs `hwdownload,format=...` after it. It is *not* used with `-f ddagrab`; that is the mistake the shape above exists to prevent. `gdigrab` stays the portable default; `ddagrab` is the faster path when the encoder is also on the GPU.

### Wayland has no native ffmpeg grabber

**C**, verified by absence: `libavdevice/alldevices.c`'s full input-device list contains no wayland, pipewire or portal entry. The documented adjacent path is `kmsgrab` (**M**, `doc/indevs.texi`):
```
ffmpeg -f kmsgrab -i - -vf 'hwdownload,format=bgr0' output.mp4
```
For a wlroots compositor the usual external tool is `wf-recorder`, which uses `wlr-screencopy-v1` (its own README, https://github.com/ammen99/wf-recorder). A desktop-portal path (`org.freedesktop.portal.ScreenCast`) exists at the freedesktop level but is not an ffmpeg input device. All of this is the Linux parity row, not the reference path.

### Cut detection

The **only** documented `scene` example, byte-identical in `doc/filters.texi` at tag `n1.0` and on `master` (**M**):
```
ffmpeg -i video.avi -vf select='gt(scene\,0.4)',scale=160:120,tile -frames:v 1 preview.png
```
Three things the Phase C spec got wrong, and this is why D4 runs before any code:

1. **The comma must be escaped.** The attested spelling is `gt(scene\,0.4)`. The spec wrote `gt(scene,0.3)` with a bare comma, which the filtergraph parser reads as an argument separator. (`doc/utils.texi`: "A special character is escaped by prefixing it with a `\`." Quoting instead of escaping is also documented in general, but no page shows the spec's exact unescaped string.)
2. **The threshold.** 0.4 is the documented example value. The manual's guidance is "Comparing scene against a value between 0.3 and 0.5 is generally a sane choice." 0.3 is the bottom of that range, not a default.
3. **`select` + `showinfo` is a composition, not a documented recipe (U).** The documented example produces a *tile sheet*, not timestamps. `showinfo` does print per-frame information including timestamps (**M**), and chaining two documented filters is legitimate — but the composite appears on no page and must be marked as composed, then observed.

Better than either: `select` exports the score as frame metadata `lavfi.scene_score` (**C**, `libavfilter/f_select.c`, which carries a `// TODO: document metadata` comment right above it — so this is real but officially undocumented).

### Palette

**C**, `libavfilter/vf_palettegen.c`: "Returns only one frame at the end containing the full palette." `max_colors` defaults to 256, minimum 2, maximum 256. That single-frame behaviour is what makes a palette deterministic across runs of the same input, which is the property `video-read`'s test depends on.

### Audio energy

**M**, `doc/filters.texi` (tag `n1.2` for the small file, section re-checked on `master`):
```
silencedetect=n=-50dB:d=5
ffmpeg -f lavfi -i amovie=silence.mp3,silencedetect=noise=0.0001 -f null -
```
`n`/`noise` is the threshold, `d`/`duration` the minimum silent span. It reports through frame metadata (`lavfi.silence_start` and its companions). `ebur128` is the EBU R128 loudness scanner and is the right filter when you want a perceptual energy curve rather than a silence mask.

### The tail frame

**M**, `doc/ffmpeg.texi` — this was the spec's most load-bearing unverified claim and it half-holds:
```
-sseof position      (input)      "Like the -ss option but relative to the 'end of file'. That is
                                   negative values are earlier in the file, 0 is at EOF."
-frames[:stream_specifier] framecount
```
So `-sseof -0.1` and `-frames:v 1` are each documented, and `-sseof` is input-only. **But** the same manual says of seeking: "Note that in most formats it is not possible to seek exactly, so `ffmpeg` will seek to the closest seek point before `position`." That supports *a frame near the end*, not *the last frame*.

```
ffmpeg -sseof -0.1 -i clip-N.mp4 -frames:v 1 tail-N.png      # U: composed from documented options
```
Downgrade the spec's mark from "unverified" to **"composed from documented options; behaviour not observed"**, and close it by running it — which needs no network and no gate:
```
ffmpeg -h filter=select
ffmpeg -h filter=palettegen
ffmpeg -h full | grep -n sseof
ffmpeg -version                                  # pin the build you observed it on
```
That converts these from unverified-by-documentation to **observed on a named build**, which is the honest category for a command no page shows. `-vframes` still works as an obsolete alias for `-frames:v` (**M**) — prefer the modern spelling.

## Verify it works
```
ffmpeg -version
```
Expected: `ffmpeg version 9.x` on the reference machine, plus the configure line — read it to know whether the build is LGPL or GPL and whether `libass` (needed to burn subtitles) and `gdigrab`/`x11grab` are compiled in:
```
ffmpeg -devices | grep -E 'gdigrab|x11grab|kmsgrab'
ffmpeg -filters | grep -E 'select|palettegen|silencedetect|ebur128|subtitles'
```

## Uninstall
The distribution's package manager. On the reference machine ffmpeg predates OmniHarness, so removing it is the owner's decision and goes on the triage list, never an agent's.

## License
ffmpeg: LGPL-2.1-or-later, or GPL-2.0-or-later when built with GPL components — the binary's own `-version` output is authoritative. `wf-recorder`: MIT per its repository (read as a pointer only, not audited here).

## Source
https://github.com/FFmpeg/FFmpeg — `doc/indevs.texi`, `doc/ffmpeg.texi`, `doc/filters.texi`, `doc/utils.texi`, `libavdevice/alldevices.c`, `libavdevice/gdigrab.c`, `libavfilter/vsrc_ddagrab.c`, `libavfilter/f_select.c`, `libavfilter/vf_palettegen.c`, `libavfilter/af_silencedetect.c` · https://github.com/ammen99/wf-recorder (`ffmpeg.org` is egress-blocked from the research environment; the `.texi` sources are what those pages are generated from)

Verified on 2026-09-15.
