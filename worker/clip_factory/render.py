from __future__ import annotations

import subprocess
from pathlib import Path

from .models import ClipCandidate, TranscriptSegment


def _srt_time(seconds: float) -> str:
    milliseconds = max(0, int(round(seconds * 1000)))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def _split_words(
    words: list[dict],
    max_chars: int = 38,
    max_words: int = 7,
) -> list[tuple[float, float, str]]:
    chunks: list[tuple[float, float, str]] = []
    current: list[dict] = []
    current_chars = 0

    def flush() -> None:
        nonlocal current, current_chars
        if not current:
            return
        text = " ".join(str(w["text"]).strip() for w in current).strip()
        if text:
            chunks.append((float(current[0]["start"]), float(current[-1]["end"]), text))
        current = []
        current_chars = 0

    for word in words:
        text = str(word.get("text", "")).strip()
        if not text:
            continue
        punctuation_break = text.endswith((".", "?", "!", ":", ";"))
        projected = current_chars + (1 if current else 0) + len(text)
        if current and (projected > max_chars or len(current) >= max_words):
            flush()
        current.append(word)
        current_chars += (1 if current_chars else 0) + len(text)
        if punctuation_break:
            flush()

    flush()
    return chunks


def write_srt(
    candidate: ClipCandidate,
    segments: list[TranscriptSegment],
    output: Path,
) -> Path:
    """Create short, readable caption blocks with word-level timing."""
    entries: list[str] = []
    index = 1

    for segment in segments:
        overlapping_words = []
        if segment.words:
            for word in segment.words:
                start = float(word["start"])
                end = float(word["end"])
                if end > candidate.start and start < candidate.end:
                    overlapping_words.append({
                        "start": max(start, candidate.start) - candidate.start,
                        "end": min(end, candidate.end) - candidate.start,
                        "text": word["text"],
                    })

        chunks = _split_words(overlapping_words) if overlapping_words else []
        if not chunks:
            start = max(segment.start, candidate.start) - candidate.start
            end = min(segment.end, candidate.end) - candidate.start
            text = " ".join(segment.text.split())
            if end > start and text:
                chunks = [(start, end, text)]

        for start, end, text in chunks:
            if end <= start:
                continue
            entries.append(
                f"{index}\n"
                f"{_srt_time(start)} --> {_srt_time(end)}\n"
                f"{text}\n"
            )
            index += 1

    if not entries and candidate.transcript.strip():
        text = " ".join(candidate.transcript.split())
        entries.append(
            f"1\n{_srt_time(0)} --> {_srt_time(candidate.duration)}\n{text}\n"
        )

    output.write_text("\n".join(entries), encoding="utf-8")
    return output


def render_vertical(
    source: Path,
    candidate: ClipCandidate,
    output: Path,
    segments: list[TranscriptSegment],
) -> Path:
    """Render a 9:16 MP4 with readable, correctly timed burned-in captions."""
    output.parent.mkdir(parents=True, exist_ok=True)
    subtitle_file = output.with_suffix(".srt")
    write_srt(candidate, segments, subtitle_file)

    subtitle_path = str(subtitle_file.resolve()).replace("\\", "/").replace(":", "\\:")
    vf = (
        "scale=1080:1920:force_original_aspect_ratio=increase,"
        "crop=1080:1920,setsar=1,"
        f"subtitles='{subtitle_path}':charenc=UTF-8:force_style='FontName=Arial,"
        "FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=3,"
        "Alignment=2,MarginV=180'"
    )

    cmd = [
        "ffmpeg", "-y",
        "-ss", f"{candidate.start:.3f}",
        "-i", str(source),
        "-t", f"{candidate.duration:.3f}",
        "-vf", vf,
        "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        str(output),
    ]
    subprocess.run(cmd, check=True)
    return output
