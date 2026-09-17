FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg git curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY clip_factory ./clip_factory
COPY run_worker.py ./run_worker.py

ENV CLIP_FACTORY_WORKER_HOST=0.0.0.0 \
    CLIP_FACTORY_WORKER_PORT=8765 \
    CLIP_FACTORY_DATA_DIR=/data \
    WHISPER_MODEL=small

EXPOSE 8765

CMD ["python", "run_worker.py"]
