@echo off
REM ===========================================================================
REM  INFRAvx / Infracentra - Windows launcher (FULL STACK = real backend)
REM  Requires Docker Desktop running. Starts Postgres + FastAPI (:8000) +
REM  the Vite dev server (:5173). On the login page toggle DEMO MODE OFF
REM  to authenticate against the live backend.
REM ===========================================================================
setlocal
cd /d "%~dp0"

docker info >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Docker is not running. Start Docker Desktop, then re-run this script.
    pause
    exit /b 1
)

echo [1/3] Starting backend ^(Postgres + FastAPI on 127.0.0.1:8000^)...
docker compose -f docker-compose.prebuilt.yml up -d
if errorlevel 1 (
    echo [ERROR] docker compose failed. Check Docker Desktop is running.
    pause
    exit /b 1
)

echo [2/3] Waiting for the API to answer on http://127.0.0.1:8000 ...
set /a tries=0
:waitapi
powershell -NoProfile -Command "try{Invoke-WebRequest -Uri http://127.0.0.1:8000/docs -UseBasicParsing -TimeoutSec 2 ^| Out-Null; exit 0}catch{exit 1}" >nul 2>nul
if not errorlevel 1 goto apiup
set /a tries+=1
if %tries% geq 60 (
    echo [WARN] API not answering after 60s. Backend logs: docker compose -f docker-compose.prebuilt.yml logs api
    goto frontend
)
timeout /t 2 /nobreak >nul
goto waitapi
:apiup
echo       API is UP.

:frontend
echo [3/3] Starting frontend at http://localhost:5173  ^(toggle DEMO MODE OFF to use the real backend^)
start "" http://localhost:5173
call npm run dev
endlocal
