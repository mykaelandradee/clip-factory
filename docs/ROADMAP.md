# Roadmap

## Phase 1 — Core Clip Factory

- Next.js dashboard
- YouTube URL input
- local worker
- yt-dlp download
- Whisper transcription with timestamps
- selectable AI provider: OpenAI, Anthropic, Ollama
- structured clip selection
- FFmpeg 9:16 rendering
- burned-in subtitles
- preview/export

## Phase 2 — Production workflow

- persistent projects and jobs
- job queue and progress
- clip history
- reusable caption/video templates
- AI-generated title, description and hashtags
- local/network storage adapter
- retry/error handling

## Phase 3 — Publishing automation

Publishing is designed as adapters so the core rendering pipeline remains independent of social networks.

### YouTube Shorts

Use Google OAuth 2.0 and the YouTube Data API upload flow. The worker will upload the rendered MP4 and metadata, track processing state, and support scheduled/private publishing where supported by the API/account configuration.

### Instagram

Implement an Instagram publishing adapter around Meta's supported Graph API flow for professional accounts. The dashboard will handle account connection and publishing state; the worker will handle media preparation and upload orchestration.

### Scheduler

The dashboard will store a publish queue such as:

- clip
- destination
- caption
- hashtags
- publish_at
- status
- remote_id
- last_error

A scheduler will wake jobs at their requested time and call the appropriate platform adapter.

## Important constraint

Social publishing will require the user's own platform authorization and credentials. The application will never store a username/password for YouTube or Instagram. OAuth tokens will be encrypted/stored server-side when this phase is implemented.
