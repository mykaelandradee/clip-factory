$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "[Clip Factory] Criando ambiente Python..."
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt

Write-Host "[Clip Factory] Verificando FFmpeg..."
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Warning "FFmpeg não foi encontrado no PATH. Instale o FFmpeg e abra um novo PowerShell antes de processar vídeos."
}

if (-not (Test-Path ".env")) {
    Copy-Item "..\.env.example" ".env"
    Write-Host "Arquivo worker/.env criado a partir de .env.example. Preencha sua chave de IA antes de executar."
}

Write-Host "Concluído. Execute: .\.venv\Scripts\python.exe run.py 'URL_DO_YOUTUBE'"
