# Clip Factory

AI-assisted video clipping pipeline for turning long-form videos into short vertical clips.

## Roadmap

- Phase 1: YouTube URL → transcription → AI clip suggestions → FFmpeg rendering → 9:16 subtitles → batch export
- Phase 2: projects, templates, queue, storage, previews and metadata generation
- Phase 3: YouTube Shorts + Instagram publishing/scheduling

## Architecture

- `web/`: Next.js dashboard deployed on Vercel
- `worker/`: local/container worker for yt-dlp, Whisper and FFmpeg
- `shared/`: shared schemas and types

The worker is intentionally separated from Vercel because video downloading, transcription and FFmpeg rendering are long-running CPU/file workloads.
