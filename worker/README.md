# Clip Factory Worker

O worker executa o processamento pesado: download do YouTube, Whisper, seleção por IA e renderização FFmpeg. O dashboard fica hospedado na Vercel e se comunica com o worker por uma API protegida por token.

## Arquitetura atual

`Vercel → Worker Docker → yt-dlp → Whisper → IA → FFmpeg → MP4`

O worker pode rodar localmente durante o desenvolvimento ou em uma VM Linux na nuvem. Para o ambiente cloud, consulte `DEPLOY_ORACLE.md`.

## Windows — desenvolvimento local

1. Instale Python 3.11+.
2. Instale FFmpeg e deixe `ffmpeg` disponível no PATH.
3. Abra PowerShell nesta pasta.
4. Execute `./setup.ps1`.
5. Edite `worker/.env` e informe a chave do provedor de IA escolhido.
6. Execute `./start_worker.ps1`.

O worker ficará disponível em `http://127.0.0.1:8765`.

## Cloud

A imagem Docker configura o worker para escutar em `0.0.0.0:8765` e possui health check em `/health`.

O diretório `/data` deve ser montado em armazenamento persistente. O token `CLIP_FACTORY_WORKER_TOKEN` deve ser configurado tanto no worker quanto na Vercel.

## Estrutura do processamento

`YouTube → yt-dlp → Whisper → IA → FFmpeg → MP4 9:16`

Os arquivos ficam em `data/projects/<id>/`, incluindo a transcrição, os candidatos e os MP4 renderizados.

A publicação automática para YouTube Shorts e Instagram será adicionada depois que o pipeline principal estiver estável.
