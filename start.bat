@echo off
title Clarity Mesh Launcher
echo ======================================================================
echo              CLARITY MESH - WORKSTATION EDITION
echo ======================================================================
echo.
echo [1/2] Starting FastAPI Backend on http://127.0.0.1:8000 ...
start "Clarity Mesh - Backend API" cmd /k "cd /d ""%~dp0backend"" && venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload"

echo [2/2] Starting Vite React Frontend on http://localhost:5173 ...
start "Clarity Mesh - Frontend UI" cmd /k "cd /d ""%~dp0frontend"" && npm.cmd run dev"

echo.
echo ======================================================================
echo Services started in separate terminal windows!
echo - Frontend UI:     http://localhost:5173
echo - Backend API:     http://127.0.0.1:8000
echo - Swagger Docs:    http://127.0.0.1:8000/docs
echo - Health Check:    http://127.0.0.1:8000/api/health
echo ======================================================================
echo.
echo Press any key to close this launcher window (servers will remain running).
pause >nul
