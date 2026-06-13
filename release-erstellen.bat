@echo off
setlocal
title MonitorCanvas Release erstellen
cd /d "%~dp0"

echo.
echo MonitorCanvas Release erstellen
echo Beispiel fuer eine Versionsnummer: 0.2.0
echo.
set /p VERSION=Versionsnummer: 

if "%VERSION%"=="" (
  echo Keine Versionsnummer eingegeben.
  pause
  exit /b 1
)

call "%~dp0auf-github-sichern.bat"
if errorlevel 1 exit /b 1

git tag -a "v%VERSION%" -m "MonitorCanvas %VERSION%"
if errorlevel 1 (
  echo.
  echo Diese Version existiert bereits oder konnte nicht erstellt werden.
  pause
  exit /b 1
)

git push origin "v%VERSION%"
if errorlevel 1 (
  echo.
  echo Der Versions-Tag konnte nicht zu GitHub uebertragen werden.
  pause
  exit /b 1
)

echo.
echo GitHub erstellt jetzt automatisch:
echo - MonitorCanvas-%VERSION%-Setup.exe
echo - MonitorCanvas-%VERSION%-Portable.zip
echo.
echo Fortschritt:
echo https://github.com/TomMen74/MonitorCanvas/actions
echo.
pause
