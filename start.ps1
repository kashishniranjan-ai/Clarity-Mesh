# Clarity Mesh Workstation Launcher Script (PowerShell)
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "         CLARITY MESH - WORKSTATION EDITION LAUNCHER                  " -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "[1/2] Starting FastAPI Backend on http://127.0.0.1:8000 ..." -ForegroundColor Yellow
Start-Process cmd.exe -ArgumentList "/k cd /d `"$rootDir\backend`" && venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload" -WindowStyle Normal

Write-Host "[2/2] Starting Vite React Frontend on http://localhost:5173 ..." -ForegroundColor Yellow
Start-Process cmd.exe -ArgumentList "/k cd /d `"$rootDir\frontend`" && npm.cmd run dev" -WindowStyle Normal

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Green
Write-Host "Services started in separate terminal windows!" -ForegroundColor Green
Write-Host "  - Frontend UI:     http://localhost:5173" -ForegroundColor White
Write-Host "  - Backend API:     http://127.0.0.1:8000" -ForegroundColor White
Write-Host "  - Swagger Docs:    http://127.0.0.1:8000/docs" -ForegroundColor White
Write-Host "  - Health Check:    http://127.0.0.1:8000/api/health" -ForegroundColor White
Write-Host "======================================================================" -ForegroundColor Green
