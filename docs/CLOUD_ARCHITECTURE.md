# Cloud architecture

The target architecture is cloud-first. The web dashboard runs on Vercel, while video processing runs in a dedicated container worker with FFmpeg and Whisper. The worker exposes a small HTTP API for jobs and can be deployed to a container platform.

## Components

- **Web:** Next.js dashboard on Vercel.
- **Worker:** Python 3.11 container with yt-dlp, Whisper and FFmpeg.
- **AI:** OpenAI, Anthropic or Ollama through the provider abstraction.
- **Storage:** object storage will hold source videos and rendered clips in the production version.
- **Queue:** the production version should use a persistent queue so jobs survive worker restarts.

The current worker can run locally for development and is also packaged with `worker/Dockerfile` for cloud deployment. The worker binds to `127.0.0.1` by default for local safety; a container deployment can set `CLIP_FACTORY_WORKER_HOST=0.0.0.0`.

## Production sequence

1. Dashboard creates a job.
2. Persistent queue stores the job.
3. Worker downloads the source video.
4. Whisper creates timestamped transcription.
5. Selected AI provider identifies clip candidates.
6. FFmpeg renders vertical clips.
7. Clips are uploaded to object storage.
8. Dashboard receives status and signed/public clip URLs.
9. Later, publishing adapters send approved clips to YouTube Shorts and Instagram.

The cloud worker is intentionally separated from the Next.js app because video download, Whisper and FFmpeg are long-running workloads and should not depend on a short-lived web request.
