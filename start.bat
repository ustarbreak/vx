@echo off
REM ===========================================================================
REM  INFRAvx / Infracentra - Windows one-click launcher (DEMO MODE)
REM  Double-click this file. It starts the Vite DEV server (port 5173).
REM  Demo Mode works with NO backend, NO Docker, NO Postgres running:
REM  all 16 services + Advanced Ticketing are simulated in the browser.
REM  NOTE: this file MUST be saved as ANSI/OEM (CRLF), not UTF-8, and must
REM  contain no accented characters, or cmd.exe may mis-parse it on some
REM  Windows locales. Keep comments ASCII-only.
REM ===========================================================================
setlocal enabledelayedexpansion
title INFRAvx Demo Launcher
cd /d "%~dp0"

echo.
echo  ==============================================
echo   INFRAvx - DEMO launcher
echo  ==============================================
echo.

REM --- 1. Node.js present? -------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo         Download the LTS installer from https://nodejs.org
    echo         IMPORTANT: after installing, CLOSE this window and
    echo         double-click start.bat again ^(a fresh terminal^).
    echo.
    pause
    exit /b 1
)
for /f "delims=" %%v in ('node -v') do echo [OK] Node.js %%v found.

REM --- 2. Project files next to this .bat? ---------------------------------
if not exist package.json (
    echo [ERROR] package.json not found in: %CD%
    echo         You probably double-clicked start.bat from OUTSIDE the
    echo         project folder. Unzip the archive FIRST, then open the
    echo         extracted folder and double-click start.bat INSIDE it.
    echo.
    pause
    exit /b 1
)
if not exist vite.config.ts (
    echo [ERROR] vite.config.ts not found in: %CD%  ^(same fix as above^).
    pause
    exit /b 1
)

REM --- 3. Dependencies -------------------------------------------------------
REM Check the ACTUAL vite binary (not just the folder): a partial/aborted
REM npm install leaves node_modules\vite present but WITHOUT bin\vite.js,
REM which makes "npm run dev" fail with "'vite' is not recognized".
if not exist "node_modules\vite\bin\vite.js" (
    echo [SETUP] Installing dependencies, first run only...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo.
        echo [ERROR] npm install failed. Common causes:
        echo   - No internet connection
        echo   - Antivirus blocking Node/npm
        echo   - Path too long or spaces in the extraction path
        echo         Try extracting the zip to a short path like C:\INFRAvx
        echo   Tip: run start-verbose.bat for a full demo-launch.log
        echo.
        pause
        exit /b 1
    )
    if not exist "node_modules\vite\bin\vite.js" (
        echo.
        echo [ERROR] npm install finished but vite is STILL missing.
        echo   Fix: delete node_modules and package-lock.json, then re-run.
        echo   Run start-verbose.bat to see the exact error in a log file.
        echo.
        pause
        exit /b 1
    )
    echo [OK] Dependencies installed.
) else (
    echo [OK] Dependencies already installed.
)

REM --- 4. Free port 5173 if something stale is holding it -------------------
netstat -ano | findstr /r /c:":5173 .*LISTENING" >nul 2>nul
if not errorlevel 1 (
    echo [WARN] Port 5173 is already in use. A previous demo server may
    echo        still be running. Close that black console window,
    echo        or press Ctrl+C in it, then re-run this script.
    echo        Continuing anyway - if a browser opens and shows the app,
    echo        it is the OLD server and that is fine for demo use.
    echo.
)

REM --- 5. Launch -------------------------------------------------------------
if exist "node_modules\.bin\vite.cmd" goto :normal
REM The npm .bin shim is missing/broken -> start vite with node directly.
set USE_NODE_FALLBACK=1

:normal
echo.
echo  Starting DEMO at  http://localhost:5173
echo  Fast access (skips login):  http://localhost:5173/#/demo
echo  Press Ctrl+C in this window to stop.
echo.
start "" http://localhost:5173
if defined USE_NODE_FALLBACK (
    echo [INFO] Using direct node fallback to start vite...
    node node_modules\vite\bin\vite.js
) else (
    call npm run dev
)

echo.
echo [INFO] The dev server exited (or was stopped with Ctrl+C).
pause
endlocal
