# Clip Factory Worker

O worker executa o processamento pesado: download do YouTube, Whisper, seleção local de trechos e renderização FFmpeg. Em produção, o processamento é executado pelos workflows do GitHub Actions; o worker também pode ser executado localmente para desenvolvimento.

## Ambiente de produção

O fluxo principal é:

`Render → GitHub Actions → worker Python → yt-dlp/Whisper/FFmpeg → Cloudflare R2`

O workflow `Clip Factory Worker` processa os jobs de geração. O workflow `Influencer Manager Worker` processa os vídeos do Influencer Manager. Os arquivos de saída são enviados para o Cloudflare R2.

## Windows — desenvolvimento local

1. Instale Python 3.11+.
2. Instale FFmpeg e deixe `ffmpeg` disponível no PATH.
3. Abra PowerShell nesta pasta.
4. Execute `./setup.ps1`.
5. Execute `./start_worker.ps1`.

O worker local ficará disponível em `http://127.0.0.1:8765`.

## Cloud

A imagem Docker continua disponível para execução independente do worker, mas não é o caminho usado pelo processamento principal em produção neste momento.

## Estrutura do processamento

`YouTube → yt-dlp → Whisper → seleção local → FFmpeg → MP4 9:16`

Os arquivos temporários ficam em `data/`.

## Observação

A publicação automática para YouTube e Instagram é tratada pelas APIs e workflows do aplicativo, separadamente do processamento do vídeo.
