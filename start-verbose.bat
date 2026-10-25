@echo off
REM ===========================================================================
REM  INFRAvx / Infracentra - Windows DIAGNOSTIC launcher (DEMO MODE)
REM  Same as start.bat but it NEVER closes: every step is logged to
REM  demo-launch.log next to this file, and the window stays open with a
REM  readable error if anything fails (e.g. "'vite' is not recognized").
REM  Use this one when start.bat opens then instantly closes.
REM  Keep this file ASCII-only and CRLF (Windows) or cmd may mis-parse it.
REM ===========================================================================
setlocal enabledelayedexpansion
title INFRAvx Demo Launcher - DIAGNOSTIC
cd /d "%~dp0"

set "LOG=%CD%\demo-launch.log"
echo ============================================== > "%LOG%"
echo  INFRAvx diagnostic log - %DATE% %TIME%      >> "%LOG%"
echo  Folder: %CD%                                 >> "%LOG%"
echo ============================================== >> "%LOG%"

echo.
echo  ==============================================
echo   INFRAvx - DEMO launcher (diagnostic mode)
echo   All output is also saved to demo-launch.log
echo  ==============================================
echo.

REM --- 1. Node.js present? -------------------------------------------------
where node >>"%LOG%" 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo         Download the LTS installer from https://nodejs.org
    echo         After installing, CLOSE this window and run again.
    echo [ERROR] node not found >> "%LOG%"
    echo.
    pause
    exit /b 1
)
for /f "delims=" %%v in ('node -v') do (echo [OK] Node.js %%v found.& echo [OK] node %%v>>"%LOG%")
for /f "delims=" %%v in ('npm -v') do (echo [OK] npm %%v.& echo [OK] npm %%v>>"%LOG%")

REM --- 2. Project files next to this .bat? ---------------------------------
if not exist package.json (
    echo [ERROR] package.json not found in: %CD%
    echo         You double-clicked the .bat OUTSIDE the project folder.
    echo         Unzip the archive first, open the extracted folder,
    echo         then run start-verbose.bat INSIDE it.
    echo [ERROR] package.json missing in %CD%>>"%LOG%"
    echo.
    pause
    exit /b 1
)
if not exist vite.config.ts (
    echo [ERROR] vite.config.ts not found in: %CD%  ^(same fix as above^).
    echo [ERROR] vite.config.ts missing>>"%LOG%"
    echo.
    pause
    exit /b 1
)
echo [OK] Project files found.

REM --- 3. Dependencies (install if vite binary missing) ---------------------
if not exist "node_modules\vite\bin\vite.js" (
    echo [SETUP] Vite binary missing - running npm install...
    echo [SETUP] npm install start>>"%LOG%"
    call npm install --no-audit --no-fund >>"%LOG%" 2>&1
    if errorlevel 1 (
        echo.
        echo [ERROR] npm install FAILED. Full details are in demo-launch.log.
        echo   Common causes:
        echo     - No internet / corporate proxy
        echo     - Antivirus blocking node_modules writes
        echo     - Path too long - extract the zip to C:\INFRAvx
        echo   Fix manually: open cmd in this folder, run:  npm install
        echo.
        echo [ERROR] npm install failed>>"%LOG%"
        echo ---- last 20 lines of the log ----
        powershell -NoProfile -Command "Get-Content '%LOG%' -Tail 20" 2>nul || type "%LOG%"
        echo ----------------------------------
        pause
        exit /b 1
    )
    echo [OK] npm install finished.
) else (
    echo [OK] Vite binary present.
)

REM verify the vite bin really exists after install
if not exist "node_modules\vite\bin\vite.js" (
    echo [ERROR] npm install reported success but node_modules\vite is still
    echo         missing. Delete node_modules and package-lock.json, then run
    echo         this script again ^(fresh install^). Also check antivirus.
    echo [ERROR] vite bin still missing after install>>"%LOG%"
    pause
    exit /b 1
)

REM --- 4. Free port 5173 if something stale is holding it -------------------
netstat -ano | findstr /r /c:":5173 .*LISTENING" >nul 2>nul
if not errorlevel 1 (
    echo [WARN] Port 5173 already in use - an old server may still run.
    echo        Close the old black console window, or just open
    echo        http://localhost:5173 in your browser directly.
)

REM --- 5. Launch -------------------------------------------------------------
if exist "node_modules\.bin\vite.cmd" goto :normal
set USE_NODE_FALLBACK=1

:normal
echo.
echo  Starting DEMO at  http://localhost:5173
echo  Fast access (skips login):  http://localhost:5173#/demo
echo  Press Ctrl+C in this window to stop.
echo  [dev server output is appended to demo-launch.log]
echo.
start "" http://localhost:5173
echo [RUN] dev server start>>"%LOG%"
if defined USE_NODE_FALLBACK (
    echo [INFO] Using direct node fallback to start vite...
    node node_modules\vite\bin\vite.js >>"%LOG%" 2>&1
) else (
    call npm run dev >>"%LOG%" 2>&1
)

echo.
echo [INFO] The dev server exited. Last log lines:
powershell -NoProfile -Command "Get-Content '%LOG%' -Tail 25" 2>nul || type "%LOG%"
echo.
pause
endlocal
