$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (-not (Test-Path .venv\Scripts\python.exe)) { .\setup.ps1 }
& .\.venv\Scripts\python.exe run_worker.py
