# Blender

## What it is
Headless Blender for converting, cleaning or rendering 3D files (GLB, OBJ, FBX) from a Python script.

## When to reach for it
Only when a 3D deliverable exists. Try first: Higgsfield already produces GLB directly (`higgsfield-generate`, gated), and a GLB can be previewed in the browser without Blender. Reach for Blender to fix scale/orientation, bake, decimate, or render stills of a model you already have. Routing row "Image, video, 3D, audio": the Blender binary only when a 3D deliverable exists.

## Cost and keys
Free, no key.

## Network and the gate
Not gated: local and free. The installer download asks through `"Bash(curl:*)"` / `"Bash(wget:*)"` if fetched from the shell.

## Install
Do not `pip install bpy`: the PyPI wheel (5.2.1) requires Python `==3.13.*` exactly, and the reference machine runs Python 3.12.10. Use the Blender binary instead: download the official build from https://www.blender.org/download/ (`winget install BlenderFoundation.Blender` is UNVERIFIED) and call it headless:
```
blender --background --python script.py -- <args>
```
The script imports `bpy` from Blender's bundled Python; nothing is installed into the project interpreter.

## Activate in OmniHarness
Routing row "Image, video, 3D, audio". The agent writes `script.py` (stdlib plus `bpy`), runs the binary once with `--background --python`, and puts the output file next to the input. Not installed on the reference machine: propose the download, do not run it.
Say first: "This needs the Blender binary (a few hundred MB download, free, local); after that the run is offline. Proceed with the download?"

## Verify it works
```
blender --background --version
```
Expected: a line starting with `Blender <major>.<minor>`.

## Uninstall
Windows: Settings > Apps (or `winget uninstall BlenderFoundation.Blender`, id UNVERIFIED). No project files are touched.

## License
GPL-3.0 (Blender and the `bpy` module). Your scripts and outputs are yours.

## Source
https://www.blender.org · https://pypi.org/project/bpy/

Verified on 2026-09-10.
