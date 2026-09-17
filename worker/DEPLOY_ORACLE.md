# Deploy do worker em uma VM Oracle Cloud Always Free

O dashboard continua na Vercel. O worker pesado roda em uma VM Linux com Docker.

## Recursos recomendados

Use uma VM ARM64 OCI Ampere A1 com até 2 OCPUs e 12 GB de RAM dentro do limite Always Free.

## 1. Criar a VM

Na Oracle Cloud:

- Compute → Instances → Create instance
- Imagem: Ubuntu 24.04 ou Ubuntu compatível com ARM64
- Shape: VM.Standard.A1.Flex
- OCPUs: 2
- RAM: 12 GB
- Mantenha o volume de boot dentro do limite Always Free
- Reserve um IPv4 público

## 2. Liberar a porta do worker

No security list/NSG da VCN, permita TCP `8765` somente conforme necessário. O ideal é deixar a API protegida pelo token `CLIP_FACTORY_WORKER_TOKEN`.

## 3. Instalar Docker

No SSH da VM:

```bash
curl -fsSL https://get.docker.com | sh
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

Saia e entre novamente no SSH para aplicar o grupo Docker.

## 4. Baixar o projeto

```bash
git clone https://github.com/mykaelandradee/clip-factory.git
cd clip-factory/worker
```

## 5. Configurar variáveis

Crie `.env` com pelo menos:

```env
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6
CLIP_FACTORY_WORKER_TOKEN=
WHISPER_MODEL=small
```

Se preferir Anthropic, informe também `ANTHROPIC_API_KEY` e `ANTHROPIC_MODEL`.

## 6. Construir e executar

```bash
docker build -t clip-factory-worker .
mkdir -p ~/clip-factory-data
docker run -d \
  --name clip-factory-worker \
  --restart unless-stopped \
  --env-file .env \
  -p 8765:8765 \
  -v ~/clip-factory-data:/data \
  clip-factory-worker
```

Verifique:

```bash
curl http://127.0.0.1:8765/health
```

## 7. Configurar a Vercel

No projeto `clip-factory` da Vercel, adicione:

```text
CLIP_FACTORY_WORKER_URL=http://IP_PUBLICO_DA_VM:8765
CLIP_FACTORY_WORKER_TOKEN=mesmo_token_da_VM
```

Depois faça um novo deploy na Vercel.

## Observações

- O diretório `/data` fica em volume persistente da VM, então os jobs e MP4 não dependem do filesystem efêmero da Vercel.
- O worker atual mantém o estado dos jobs em memória; uma próxima etapa será mover jobs e metadados para o Supabase para que reinicializações não percam o estado.
- O worker não deve ficar sem autenticação quando exposto à internet.
