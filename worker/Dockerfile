FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DENO_INSTALL=/root/.deno \
    PATH=/root/.deno/bin:$PATH

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg git curl unzip ca-certificates libgomp1 \
    && curl -fsSL https://deno.land/install.sh | sh \
    && deno --version \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./requirements.txt
RUN python -m pip install --upgrade pip \
    && python -m pip install -r requirements.txt

COPY clip_factory ./clip_factory
COPY run_worker.py ./run_worker.py

ENV CLIP_FACTORY_WORKER_HOST=0.0.0.0 \
    CLIP_FACTORY_WORKER_PORT=8765 \
    CLIP_FACTORY_DATA_DIR=/data \
    WHISPER_MODEL=small

RUN mkdir -p /data

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD sh -c 'curl -fsS "http://127.0.0.1:${PORT:-8765}/health" || exit 1'

CMD ["python", "run_worker.py"]
