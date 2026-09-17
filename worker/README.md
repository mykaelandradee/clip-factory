# Clip Factory Worker

This worker runs outside Vercel and handles the heavy video workload.

Planned pipeline:

1. Download source with yt-dlp.
2. Extract audio.
3. Transcribe with Whisper (local first).
4. Ask the selected AI provider for clip candidates.
5. Render 9:16 clips with FFmpeg and subtitles.
6. Return artifacts to the web dashboard.

Publishing to YouTube Shorts and Instagram will be added after the core pipeline is stable. The worker will be designed with publishing adapters so those integrations do not need to be rewritten later.
