@echo off
rem OmniForge manager: doctor, pack, install, start, update, rollback, repair, uninstall.
rem Works from a source checkout and from an installed or extracted release (docs/omniforge/INSTALL.md).
where node >nul 2>nul || (
  echo OmniForge needs Node.js 22 or newer, and node was not found on PATH.
  echo Install it with: winget install -e --id OpenJS.NodeJS.LTS
  echo or download the Windows installer from https://nodejs.org/en/download
  exit /b 9009
)
rem One line: uninstall may delete this file while node runs, and cmd must not read it again.
node "%~dp0..\omniforge-lab\manage.mjs" %* & call exit /b %%errorlevel%%
