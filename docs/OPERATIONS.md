# Operação e troubleshooting

## 1. Verificação rápida

Antes de investigar um problema, verificar:

1. O serviço web está respondendo.
2. `/api/health` retorna `status: online`.
3. O workflow **Clip Factory Worker** está executando no GitHub Actions.
4. O job possui um `Run` correspondente.
5. O Step Summary contém os tempos do pipeline.
6. O R2 contém os arquivos em `jobs/<jobId>/`.

## 2. Health check

Endpoint:

```
GET /api/health
```

Resposta operacional esperada:

```json
{
  "status": "online",
  "backend": "github-actions",
  "checks": {
    "github": true,
    "r2": true,
    "supabase": true
  }
}
```

Em modo de geração somente, o check real do Supabase é ignorado e marcado como disponível.

Se o endpoint retornar `503`, use o objeto `checks` para identificar a dependência afetada.

## 3. Job travado ou sem progresso

Verifique:

- o `jobId`;
- o workflow correspondente;
- o último step executado;
- os logs do job;
- se o workflow foi cancelado;
- se houve falha no download do YouTube;
- se houve falha no processamento/renderização;
- se o R2 recebeu os arquivos.

O workflow possui timeout de 45 minutos e o processamento principal possui timeout de 35 minutos.

## 4. Falha no YouTube

O workflow usa:

- yt-dlp;
- runtime Deno;
- componentes EJS;
- bgutil PO Token provider;
- cookies do YouTube armazenados de forma criptografada nos GitHub Secrets.

Se o download falhar:

1. Verifique o step **Install YouTube cookie file**.
2. Verifique **Verify yt-dlp and PO token provider**.
3. Confirme que `YOUTUBE_COOKIES_PASSWORD` existe.
4. Confirme que `secrets/youtube_cookies.enc.b64` está presente.
5. Verifique se o provider bgutil chegou ao estado ready.

Nunca coloque cookies descriptografados no repositório.

## 5. Falha no R2

Variáveis necessárias no workflow:

- `R2_ACCOUNT_ID`
- `R2_BUCKET_NAME`
- `R2_PUBLIC_URL`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

O upload grava:

```
jobs/<jobId>/clip-01.mp4
jobs/<jobId>/clip-02.mp4
...
jobs/<jobId>/clip-15.mp4
```

O upload também remove objetos antigos do mesmo job antes de recalcular o armazenamento projetado.

## 6. Cancelamento

O endpoint é:

```
POST /api/jobs/cancel
```

O cancelamento:

- valida o job;
- verifica propriedade ou token anônimo;
- procura o workflow correspondente;
- retorna conflito se o workflow já terminou;
- solicita o cancelamento ao GitHub Actions quando ainda está ativo.

O cancelamento foi validado em execução real.

## 7. Retry

O endpoint é:

```
POST /api/jobs/retry
```

O retry:

- aceita jobs autenticados ou anônimos;
- não repete jobs ainda em execução;
- não repete jobs concluídos com sucesso;
- aceita conclusões de falha/cancelamento/timeout e equivalentes;
- usa `rerun-failed-jobs` no GitHub Actions;
- possui rate limit próprio.

A implementação existe, mas uma execução completa de retry deve ser validada quando ocorrer uma falha real.

## 8. Downloads

Downloads usam:

```
GET /api/jobs/download?jobId=<uuid>&file=clip-01.mp4
```

A rota valida:

- UUID do job;
- nome do arquivo;
- usuário autenticado ou token anônimo;
- existência do objeto no R2.

O frontend usa o proxy da própria aplicação para evitar expor credenciais.

## 9. Observabilidade

Cada execução bem-sucedida gera `worker/data/job-timings.json`.

O GitHub Actions também grava no Step Summary:

- Job;
- Run;
- Tentativa;
- Status;
- tempos de cada etapa.

Exemplo validado em produção:

- Job: `8f7301ff-f666-4dc4-a434-f0d18bd001f0`
- Run: `36474066449`
- Status: `success`
- Total: `165.62s`

## 10. Segurança operacional

Nunca registrar em logs:

- tokens OAuth;
- Authorization headers;
- cookies;
- senhas;
- chaves de API;
- secrets do GitHub.

Os logs estruturados do web service passam por sanitização de contexto.

## 11. Após qualquer alteração

Executar, quando aplicável:

```bash
cd web
npm test
npm run build
```

Depois:

1. fazer deploy;
2. verificar `/api/health`;
3. gerar um job pequeno de 3 clips;
4. conferir o GitHub Actions;
5. conferir o Step Summary;
6. conferir os arquivos no R2;
7. testar o download.

## 12. Onde investigar primeiro

| Sintoma | Primeiro local |
|---|---|
| Site indisponível | Render + `/api/health` |
| Job não inicia | `/api/jobs` + GitHub Actions |
| Download do YouTube falha | Steps de cookies/yt-dlp/bgutil |
| Transcrição falha | logs do worker |
| Render falha | logs FFmpeg/render |
| Job concluído sem clips | upload/R2 |
| Download do clip falha | `/api/jobs/download` + R2 |
| Cancelamento falha | `/api/jobs/cancel` + permissões do GitHub |
| Retry falha | `/api/jobs/retry` + conclusão do workflow |
| Status incorreto | `/api/jobs` + Run do GitHub |
