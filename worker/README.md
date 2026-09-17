# Clip Factory Worker

O worker executa o processamento pesado localmente: download do YouTube, Whisper, seleção por IA e renderização FFmpeg.

## Windows

1. Instale Python 3.11+.
2. Instale FFmpeg e deixe `ffmpeg` disponível no PATH.
3. Abra PowerShell nesta pasta.
4. Execute `./setup.ps1`.
5. Edite `worker/.env` e informe a chave do provedor de IA escolhido.

## Primeiro teste

```powershell
.\.venv\Scripts\python.exe run.py "https://www.youtube.com/watch?v=SEU_VIDEO" --provider openai --count 3 --min-duration 20 --max-duration 60
```

O resultado ficará em `worker/data/projects/<id>/`, incluindo a transcrição, o JSON de candidatos e os MP4 renderizados.

## Arquitetura

A etapa atual é local: vídeos, Whisper e FFmpeg não dependem de uma função serverless da Vercel. Na próxima integração, o dashboard criará jobs e o worker buscará esses jobs, evitando a necessidade de abrir uma porta do computador para a internet.

A publicação para YouTube Shorts e Instagram será adicionada depois que o pipeline principal estiver estável. O código será organizado com adaptadores de publicação para que essas integrações não exijam reescrever o processamento.
