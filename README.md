# Clip Factory

Gerador de clips curtos a partir de vídeos do YouTube, com transcrição, seleção de trechos, legendas, renderização vertical e armazenamento em Cloudflare R2.

## Arquitetura atual

```
Usuário
  │
  ▼
Next.js / Render
  │
  ├── Supabase → autenticação e dados dos jobs
  ├── GitHub Actions → processamento assíncrono
  │      ├── yt-dlp + cookies + PO Token
  │      ├── Whisper → transcrição
  │      ├── seleção de trechos
  │      ├── tradução opcional
  │      └── FFmpeg → clips 9:16
  │
  └── Cloudflare R2 → armazenamento dos clips
```

O processamento pesado não roda dentro do request HTTP. A aplicação cria um job e dispara o workflow **Clip Factory Worker** no GitHub Actions. O workflow processa os clips e publica os MP4 no R2.

## Funcionalidades

- Geração anônima ou autenticada.
- URL do YouTube com validação de domínio.
- 3, 5, 10 ou 15 clips.
- Duração configurável.
- Legendas em idioma original, PT-BR ou inglês.
- Presets de legenda: Karaoke, Fire, Youshaei, Harmozi, Beasty e Cinematic.
- Resultado parcial quando menos clips são gerados que o solicitado.
- Download individual dos clips por proxy autenticado.
- Cancelamento de jobs.
- Retry de jobs com falha.
- Rate limiting nos endpoints sensíveis.
- Tokens anônimos assinados por HMAC.
- Armazenamento dos clips no Cloudflare R2.
- OAuth para integrações de publicação.
- Health check de GitHub, R2 e Supabase.
- Logs estruturados e métricas de tempo por etapa.
- Testes unitários com Vitest.

## Estrutura

- `web/` — aplicação Next.js e API.
- `worker/` — pipeline Python, Whisper, yt-dlp e FFmpeg.
- `.github/workflows/` — processamento assíncrono, build e rotinas auxiliares.
- `docs/` — documentação operacional e arquitetura.
- `supabase/` — configuração/migrações do banco.

## Desenvolvimento local

### Web

```bash
cd web
npm install
npm run dev
```

Build:

```bash
npm run build
```

Testes:

```bash
npm test
```

### Worker

O worker local exige Python 3.11+, FFmpeg e as dependências de `worker/requirements.txt`.

```bash
cd worker
python -m pip install -r requirements.txt
python run.py "<YOUTUBE_URL>" --provider local --count 3 --min-duration 20 --max-duration 60 --subtitle-language original --caption-style karaoke
```

Para desenvolvimento local, copie `.env.example` e preencha somente as variáveis necessárias.

## Produção

O ambiente atual usa:

- **Render** para a aplicação web.
- **GitHub Actions** para o processamento dos jobs.
- **Cloudflare R2** para os arquivos de saída.
- **Supabase** para autenticação e dados.
- **YouTube OAuth / Instagram OAuth** para publicação, quando configurados.

A geração de clips não depende de login Google/Instagram.

## Fluxo de um job

1. O usuário envia uma URL do YouTube.
2. `POST /api/jobs` valida os parâmetros e cria o job.
3. A aplicação dispara o evento `clip-factory-job` no GitHub Actions.
4. O workflow baixa o vídeo, transcreve, seleciona os trechos, traduz quando necessário e renderiza os clips.
5. Os MP4 são enviados para `jobs/<jobId>/clip-XX.mp4` no R2.
6. O frontend consulta `GET /api/jobs` até o job terminar.
7. Os downloads passam pelo endpoint autenticado `/api/jobs/download`.

## Segurança

- Não colocar tokens, cookies ou chaves no Git.
- O arquivo de cookies do YouTube é descriptografado somente durante o workflow e removido ao final.
- Jobs anônimos usam token HMAC vinculado ao `jobId`.
- Endpoints sensíveis possuem validação de tamanho, autenticação/autorização e rate limit.
- Downloads não expõem diretamente credenciais do worker.
- Tokens OAuth armazenados no servidor são criptografados com `CLIP_FACTORY_TOKEN_ENCRYPTION_KEY`.
- O R2 usa credenciais separadas do frontend.

## Observabilidade

Cada execução do worker registra tempos de:

- download
- transcription
- selection
- translation
- render
- render por clip
- total

O GitHub Actions publica esses dados no **Step Summary** e também salva `job-timings.json` como artifact temporário.

O endpoint `/api/health` verifica as dependências necessárias e retorna `200` quando o ambiente está operacional ou `503` quando está degradado.

## Documentação

- [Arquitetura cloud](docs/CLOUD_ARCHITECTURE.md)
- [Operação e troubleshooting](docs/OPERATIONS.md)
- [Roadmap](docs/ROADMAP.md)

## Limites atuais

- O rate limit em memória não é compartilhado entre múltiplas instâncias do web service.
- O retry foi implementado para falhas reais do workflow; o cancelamento já foi validado em execução real.
- Os testes automatizados estão implementados, mas a execução completa depende de um ambiente com as dependências instaladas.
- Publicação em redes sociais depende das respectivas credenciais OAuth e configurações das plataformas.

## Estado do projeto

O pipeline principal de geração, armazenamento, download, cancelamento e observabilidade está operacional. A evolução seguinte deve seguir o roadmap documentado, sem reintroduzir limites artificiais para geração anônima.
