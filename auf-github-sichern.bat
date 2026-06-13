@echo off
setlocal
title MonitorCanvas auf GitHub sichern
cd /d "%~dp0"

echo.
echo MonitorCanvas wird auf GitHub gesichert...
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo Git ist auf diesem Computer noch nicht installiert.
  echo.
  echo Installiere bitte Git for Windows von:
  echo https://git-scm.com/download/win
  echo.
  echo Danach diese Datei erneut doppelklicken.
  pause
  exit /b 1
)

if not exist ".git" (
  git init
  if errorlevel 1 goto :error
)

git config user.name >nul 2>nul
if errorlevel 1 git config user.name "TomMen74"

git config user.email >nul 2>nul
if errorlevel 1 git config user.email "107171287+TomMen74@users.noreply.github.com"

git add -- README.md LICENSE.txt .gitignore index.html styles.css app.js server.ps1 start.bat auf-github-sichern.bat release-erstellen.bat launcher installer .github
if errorlevel 1 goto :error

git diff --cached --quiet
if not errorlevel 1 (
  echo Es gibt keine neuen Aenderungen zum Sichern.
) else (
  git commit -m "MonitorCanvas: Anwendung und Windows-Pakete aktualisieren"
  if errorlevel 1 goto :error
)

git branch -M main

git remote get-url origin >nul 2>nul
if errorlevel 1 (
  git remote add origin "https://github.com/TomMen74/MonitorCanvas.git"
) else (
  git remote set-url origin "https://github.com/TomMen74/MonitorCanvas.git"
)

echo.
echo Verbindung zu GitHub wird hergestellt...
echo Bei der ersten Nutzung kann sich ein Anmeldefenster oeffnen.
echo.

git push -u origin main
if errorlevel 1 goto :error

echo.
echo ==================================================
echo Fertig. MonitorCanvas ist jetzt auf GitHub gesichert.
echo https://github.com/TomMen74/MonitorCanvas
echo ==================================================
echo.
pause
exit /b 0

:error
echo.
echo Die Sicherung wurde nicht abgeschlossen.
echo Bitte schicke mir ein Foto oder einen Screenshot dieses Fensters.
echo.
pause
exit /b 1
