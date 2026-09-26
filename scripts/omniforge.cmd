@echo off
rem OmniForge manager: doctor, pack, install, start, update, rollback, repair, uninstall.
rem Works from a source checkout and from an installed or extracted release (docs/omniforge/INSTALL.md).
where node >nul 2>nul || (
  echo OmniForge needs Node.js 22 or newer, and node was not found on PATH.
  echo Install it with: winget install -e --id OpenJS.NodeJS.LTS
  echo or download the Windows installer from https://nodejs.org/en/download
  exit /b 9009
)
rem cmd re-reads a running batch after every external command, and uninstall deletes this file.
rem (goto) ends the batch context first; the rest of the line is already expanded and keeps node's exit code.
(goto) 2>nul & node "%~dp0..\omniforge-lab\manage.mjs" %*
