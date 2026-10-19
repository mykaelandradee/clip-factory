from __future__ import annotations

import argparse
import json
import os
import subprocess
import time
from pathlib import Path

import boto3
from botocore.config import Config

from clip_factory import influencer_processing as ip
from clip_factory.youtube import download_video

MAX_STORAGE_BYTES = 8 * 1024 * 1024 * 1024


def env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is not configured")
    return value


def report(stage: str, progress: int, message: str) -> None:
    print(f"[influencer-progress] {progress}% {stage}: {message}", flush=True)


def make_vertical(source: Path, output: Path) -> None:
    # Vertical: preenche a tela. Horizontal: vídeo inteiro com faixas pretas.
    from clip_factory.render import probe_dimensions, vertical_video_filter

    command = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(source),
        "-vf", f"{vertical_video_filter(probe_dimensions(source))},setsar=1",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        str(output),
    ]
    subprocess.run(command, check=True)


def probe_duration(path: Path) -> float:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
            check=True, capture_output=True, text=True,
        ).stdout.strip()
        return float(out)
    except Exception:
        return 0.0


def transcribe_video(source: Path, workdir: Path, subtitle_language: str = "original"):
    """Transcrição com Whisper (mesma do Clip Factory). Importada só quando usada.
    Em "en" o Whisper já traduz para inglês; "pt-BR" é traduzido depois da
    escolha dos trechos, como no Clip Factory."""
    from clip_factory.config import settings
    from clip_factory.transcription import transcribe

    whisper_language = "en" if subtitle_language == "en" else "original"
    return transcribe(source, workdir / "transcript.json", settings.whisper_model, whisper_language)


def translate_to_portuguese(segments, candidates) -> None:
    from clip_factory.transcription import translate_segments_to_pt

    source_language = segments[0].language if segments and segments[0].language else "en"
    translate_segments_to_pt(segments, candidates, source_language)


def r2_client():
    account_id = env("R2_ACCOUNT_ID")
    return boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=env("R2_ACCESS_KEY_ID"),
        aws_secret_access_key=env("R2_SECRET_ACCESS_KEY"),
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )


def bucket_usage(client, bucket: str) -> int:
    total, token = 0, None
    while True:
        kw = {"Bucket": bucket}
        if token:
            kw["ContinuationToken"] = token
        resp = client.list_objects_v2(**kw)
        total += sum(int(o.get("Size", 0)) for o in resp.get("Contents", []))
        if not resp.get("IsTruncated"):
            return total
        token = resp.get("NextContinuationToken")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("url")
    p.add_argument("--item-id", required=True)
    p.add_argument("--library-id", required=True)
    p.add_argument("--user-id", required=True)
    p.add_argument("--mode", default="original")
    p.add_argument("--clip-count", default="5")
    p.add_argument("--caption-style", default=ip.DEFAULT_CAPTION_STYLE)
    p.add_argument("--subtitle-language", default=ip.DEFAULT_SUBTITLE_LANGUAGE)
    a = p.parse_args()

    mode = ip.normalize_mode(a.mode)
    clip_count = ip.normalize_clip_count(a.clip_count)
    caption_style = ip.normalize_caption_style(a.caption_style)
    # Sem legenda (modo Original), a transcrição fica no idioma do áudio.
    subtitle_language = "original" if mode == "original" else ip.normalize_subtitle_language(a.subtitle_language)
    started = time.perf_counter()
    data_dir = Path(os.environ.get("CLIP_FACTORY_DATA_DIR", "data"))
    d = data_dir / "influencer" / a.item_id
    d.mkdir(parents=True, exist_ok=True)

    report("download", 10, "Baixando vídeo original...")
    source, info = download_video(a.url, d)
    original = d / "original.mp4"
    if source.resolve() != original.resolve():
        if original.exists():
            original.unlink()
        source.rename(original)
    if not original.is_file() or original.stat().st_size < 1024:
        raise RuntimeError("O vídeo baixado é inválido ou está vazio.")
    duration = float(info.get("duration") or 0) or probe_duration(original)
    ip.validate_duration(mode, duration)
    report("download", 25, f"Download concluído ({int(duration)} s).")

    # Transcrição: obrigatória para Legendado/Cortes; no modo Original é um
    # bônus (alimenta o texto por IA) e uma falha não impede a publicação.
    segments = []
    try:
        report("transcribe", 35, "Transcrevendo o áudio...")
        segments = transcribe_video(original, d, subtitle_language)
    except Exception as error:
        if mode != "original":
            raise
        print(f"[influencer] transcription skipped: {error}", flush=True)
    source_transcript = ip.trim_transcript(" ".join(s.text.strip() for s in segments))

    prefix = ip.item_prefix(a.user_id, a.library_id, a.item_id)
    rendered: list[tuple[ip.OutputVideo, Path]] = []

    if mode == "original":
        report("render", 60, "Convertendo vídeo para 9:16...")
        out = d / "video.mp4"
        make_vertical(original, out)
        rendered.append((ip.OutputVideo(1, ip.output_key(prefix, mode, 1), 0.0, duration, source_transcript), out))
    else:
        from clip_factory.models import ClipCandidate
        from clip_factory.render import render_vertical

        if mode == "captioned":
            candidates = [ClipCandidate(0.0, duration, "", "", "", 1.0, source_transcript)]
        else:
            from clip_factory.ai import select_clips
            from clip_factory.config import settings

            report("analyze", 50, f"Escolhendo os {clip_count} melhores trechos...")
            candidates = select_clips("local", segments, clip_count, ip.CLIP_MIN_SECONDS, ip.CLIP_MAX_SECONDS, settings)
            if not candidates:
                raise RuntimeError("Não foram encontrados trechos com fala suficiente para gerar cortes.")
            candidates = sorted(candidates, key=lambda c: c.start)

        if subtitle_language == "pt-BR":
            report("translate", 52, "Traduzindo a legenda para português...")
            translate_to_portuguese(segments, candidates)

        for index, candidate in enumerate(candidates, start=1):
            report("render", 55 + int(30 * index / len(candidates)), f"Legendando vídeo {index} de {len(candidates)}...")
            out = d / ("video.mp4" if mode == "captioned" else f"clip-{index:02d}.mp4")
            render_vertical(original, candidate, out, segments, caption_style)
            rendered.append((ip.OutputVideo(
                index, ip.output_key(prefix, mode, index), round(candidate.start, 3), round(candidate.end, 3),
                ip.trim_transcript(" ".join(
                    s.text.strip() for s in segments if s.end > candidate.start and s.start < candidate.end
                )) or ip.trim_transcript(candidate.transcript), candidate.title or "",
            ), out))

    for output, path in rendered:
        if not path.is_file() or path.stat().st_size < 1024:
            raise RuntimeError(f"O vídeo {output.index} não foi gerado corretamente.")

    report("upload", 88, f"Enviando {len(rendered)} vídeo(s) para o R2...")
    client = r2_client()
    bucket = env("R2_BUCKET_NAME")
    total_size = sum(path.stat().st_size for _, path in rendered)
    if bucket_usage(client, bucket) + total_size > MAX_STORAGE_BYTES:
        raise RuntimeError("Upload bloqueado pelo limite interno de armazenamento do R2.")
    for output, path in rendered:
        with path.open("rb") as handle:
            client.upload_fileobj(handle, bucket, output.key, ExtraArgs={
                "ContentType": "video/mp4",
                "CacheControl": "public, max-age=31536000, immutable",
            })

    manifest = ip.Manifest(
        version=1, item_id=a.item_id, mode=mode,
        caption_style=None if mode == "original" else caption_style,
        subtitle_language=None if mode == "original" else subtitle_language,
        source_title=str(info.get("title") or ""), source_description=str(info.get("description") or "")[:5000],
        source_duration=round(duration, 3),
        transcript=ip.trim_transcript(" ".join(s.text.strip() for s in segments)) or source_transcript,
        outputs=[output for output, _ in rendered],
    ).to_dict()
    # O manifesto é o que o web lê para criar os itens da biblioteca.
    client.put_object(
        Bucket=bucket, Key=ip.manifest_key(prefix),
        Body=json.dumps(manifest, ensure_ascii=False).encode("utf-8"),
        ContentType="application/json; charset=utf-8", CacheControl="no-store",
    )

    public_url = env("R2_PUBLIC_URL").rstrip("/")
    result = {**manifest, "libraryId": a.library_id, "url": f"{public_url}/{rendered[0][0].key}",
              "elapsed": round(time.perf_counter() - started, 2)}
    Path("data").mkdir(exist_ok=True)
    Path("data/influencer-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    report("ready", 100, f"{len(rendered)} vídeo(s) prontos na biblioteca.")


if __name__ == "__main__":
    main()
