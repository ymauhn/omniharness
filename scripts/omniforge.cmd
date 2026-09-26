@echo off
rem OmniForge manager: doctor, pack, install, start, update, rollback, repair, uninstall.
rem Works from a source checkout and from an installed or extracted release (docs/omniforge/INSTALL.md).
setlocal
rem %%~$PATH:I searches PATH only; a bare "node" would run a node.exe from the current folder first.
for %%I in (node.exe) do set "OMNIFORGE_NODE=%%~$PATH:I"
if not defined OMNIFORGE_NODE (
  echo OmniForge needs Node.js 22 or newer, and node was not found on PATH.
  echo Install it with: winget install -e --id OpenJS.NodeJS.LTS
  echo or download the Windows installer from https://nodejs.org/en/download
  exit /b 9009
)
rem cmd re-reads a running batch after every external command, and uninstall deletes this file.
rem (goto) ends the batch context (and setlocal) first; the rest of the line is already expanded and keeps node's exit code.
(goto) 2>nul & "%OMNIFORGE_NODE%" "%~dp0..\omniforge-lab\manage.mjs" %*
