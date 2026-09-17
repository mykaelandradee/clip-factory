# Clip Factory Worker

O worker executa localmente o processamento pesado: download do YouTube, Whisper, seleção por IA e renderização FFmpeg. O dashboard pode ficar hospedado na Vercel e se comunica com o worker pelo endereço local `http://127.0.0.1:8765`.

## Windows

1. Instale Python 3.11+.
2. Instale FFmpeg e deixe `ffmpeg` disponível no PATH.
3. Abra PowerShell nesta pasta.
4. Execute `./setup.ps1`.
5. Edite `worker/.env` e informe a chave do provedor de IA escolhido.
6. Execute `./start_worker.ps1`.

O worker ficará disponível em `http://127.0.0.1:8765`.

## Dashboard

Com o worker rodando, abra o dashboard Clip Factory. Ele verifica automaticamente se o worker está online. Ao clicar em **Analisar vídeo**, o dashboard envia a URL e as opções para o worker, acompanha o progresso e exibe os MP4 gerados.

O worker escuta somente em `127.0.0.1` por padrão; ele não deve ser exposto diretamente à internet.

## Estrutura do processamento

`YouTube → yt-dlp → Whisper → IA → FFmpeg → MP4 9:16`

Os arquivos ficam em `worker/data/projects/<id>/`, incluindo a transcrição, o JSON de candidatos e os MP4 renderizados.

A publicação automática para YouTube Shorts e Instagram será adicionada depois que o pipeline principal estiver estável.
