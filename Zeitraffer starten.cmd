@echo off
rem Startet die Zeitraffer-App ohne Konsolenfenster-Ballast
if not exist "%~dp0node_modules\electron\dist\electron.exe" (
  echo Electron fehlt - bitte einmalig "npm run setup" im App-Ordner ausfuehren.
  pause
  exit /b 1
)
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0." %*
