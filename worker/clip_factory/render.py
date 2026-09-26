from __future__ import annotations

import subprocess
from pathlib import Path

from .models import ClipCandidate, TranscriptSegment


def _ass_time(seconds: float) -> str:
    seconds = max(0.0, seconds)
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def _ass_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}")


def _word_events(candidate: ClipCandidate, segments: list[TranscriptSegment]) -> list[tuple[float, float, str]]:
    events = []
    for segment in segments:
        raw_words = []
        for word in segment.words:
            start = float(word["start"])
            end = float(word["end"])
            text = str(word.get("text", "")).strip()
            if not text or end <= candidate.start or start >= candidate.end:
                continue
            raw_words.append((start, end, text))

        # If Whisper did not return word-level timestamps for this segment,
        # keep the segment captioned as one event instead of silently losing
        # the subtitle.
        if not raw_words:
            segment_start = max(float(segment.start), candidate.start)
            segment_end = min(float(segment.end), candidate.end)
            segment_text = str(segment.text).strip()
            if segment_text and segment_end > segment_start:
                events.append((
                    segment_start - candidate.start,
                    segment_end - candidate.start,
                    segment_text,
                ))
            continue

        # Whisper word timestamps can occasionally overlap into the following
        # word. Clamp each word to the next word's start so only the word that
        # is actually being spoken can be highlighted.
        for index, (start, end, text) in enumerate(raw_words):
            if index + 1 < len(raw_words):
                end = min(end, raw_words[index + 1][0])
            if end <= start:
                continue
            events.append((
                max(start, candidate.start) - candidate.start,
                min(end, candidate.end) - candidate.start,
                text,
            ))
    return events


PRESETS = {
    "karaoke": dict(font="DejaVu Sans", size=76, bold=1, primary="&H00FFFFFF", active="&H0000FFFF", outline=5, shadow=2, margin=440, spacing=0, alignment=2, scale_x=100, scale_y=100),
    "fire": dict(font="DejaVu Sans Condensed", size=76, bold=1, primary="&H00FFFFFF", active="&H000080FF", outline=5, shadow=2, margin=440, spacing=0, alignment=2, scale_x=100, scale_y=100),
    "youshaei": dict(font="Liberation Sans", size=76, bold=1, primary="&H00FFFFFF", active="&H00FFBF00", outline=5, shadow=2, margin=440, spacing=0, alignment=2, scale_x=100, scale_y=100),
    "harmozi": dict(font="DejaVu Sans Mono", size=76, bold=1, primary="&H00FFFFFF", active="&H004FFF7C", outline=5, shadow=2, margin=440, spacing=0, alignment=2, scale_x=100, scale_y=100),
    "beasty": dict(font="DejaVu Sans Mono", size=78, bold=1, primary="&H00FFFFFF", active="&H00000000", outline=0, shadow=0, margin=455, spacing=-1, alignment=2, scale_x=100, scale_y=100),
    "cinematic": dict(font="DejaVu Serif", size=58, bold=0, primary="&H00FFFFFF", active="&H00FFFFFF", outline=2, shadow=1, margin=470, spacing=1, alignment=2, scale_x=100, scale_y=100),
}


def _group_words(words, style: str):
    limits = {
        "karaoke": (3, 26),
        "fire": (2, 21),
        "beasty": (2, 18),
        "youshaei": (4, 32),
        "harmozi": (3, 25),
        "cinematic": (5, 38),
    }
    max_words, max_chars = limits.get(style, limits["karaoke"])
    groups, current, chars = [], [], 0
    for word in words:
        speech_gap = word[0] - current[-1][1] if current else 0.0
        projected = chars + len(word[2]) + (1 if current else 0)
        if current and (speech_gap > CAPTION_MAX_PAUSE or len(current) >= max_words or projected > max_chars):
            groups.append(current)
            current, chars = [], 0
        current.append(word)
        chars += len(word[2]) + (1 if chars else 0)
    if current:
        groups.append(current)
    return groups


def _base_phrase(group) -> str:
    return " ".join(_ass_escape(raw_text.upper()) for _, _, raw_text in group)


def _active_phrase(group, active_index: int, style: str) -> str:
    """Render one complete phrase with exactly one word colorized.

    The phrase is emitted as a single ASS dialogue event. This is intentionally
    not an overlay: inactive words remain white in the same event, while only
    the active word receives the preset color.
    """
    p = PRESETS.get(style, PRESETS["karaoke"])
    pieces = []
    for index, (_, _, raw_text) in enumerate(group):
        text = _ass_escape(raw_text.upper())
        if index != active_index:
            pieces.append(f"{{\\1c{p['primary']}}}{text}")
            continue

        # Each preset gets a deliberate visual signature while preserving
        # the same hard-cut word timing.
        if style == "fire":
            pieces.append(f"{{\\1c{p['active']}\\3c&H00000000&\\bord8\\fs92}}{text}")
        elif style == "youshaei":
            pieces.append(f"{{\\1c{p['active']}\\u1\\bord3}}{text}")
        elif style == "harmozi":
            pieces.append(f"{{\\1c{p['active']}\\3c&H00181818&\\bord6\\fs88}}{text}")
        else:
            pieces.append(f"{{\\1c{p['active']}}}{text}")
    return " ".join(pieces)


def _event_text(group, style: str) -> str:
    # Kept for the existing Beasty/Cinematic paths. The active-word overlay
    # renderer below is used for the four color-highlight styles.
    p = PRESETS.get(style, PRESETS["karaoke"])
    pieces = []
    for _, (_, _, raw_text) in enumerate(group):
        text = _ass_escape(raw_text.upper())
        if style == "beasty":
            for active_index, (word_start, word_end, _) in enumerate(group):
                pieces = []
                for index, (_, _, raw_word) in enumerate(group):
                    word_text = _ass_escape(raw_word.upper())
                    if index == active_index:
                        pieces.append("{\\rBeastyBox}" + word_text + "{\\rCaption}")
                    else:
                        pieces.append("{\\c&H00FFFFFF&}" + word_text)
                text = " ".join(pieces)
                lines.append(
                    f"Dialogue: 0,{_ass_time(word_start)},{_ass_time(word_end)},",
                    f"Caption,,0,0,0,{text}"
                )
            continue
        # Cinematic remains on its existing personality path.
        if style == "cinematic":
            words_text = [_ass_escape(raw.upper()) for _, _, raw in group]
            midpoint = max(1, len(words_text) // 2)
            line1 = " ".join(words_text[:midpoint])
            line2 = " ".join(words_text[midpoint:])
            text = line1 if not line2 else line1 + "\\N" + line2
            lines.append(
                f"Dialogue: 0,{_ass_time(start)},{_ass_time(end)},",
                f"Caption,,0,0,0,{text}"
            )
            continue
        # Exactly one caption event is visible at any moment. We split the
        # phrase into word-timed slices instead of drawing a white base plus a
        # colored overlay. This keeps the caption visually single and prevents
        # duplicate outlines/shadows from stacking.
        for active_index, (word_start, word_end, _) in enumerate(group):
            phrase = _active_phrase(group, active_index, style)
            lines.append(
                f"Dialogue: 0,{_ass_time(word_start)},{_ass_time(word_end)},"
                f"Caption,,0,0,0,{phrase}"
            )

        # Keep the phrase white during pauses between words. This is still a
        # single caption event, never an overlapping foreground/background pair.
        for index in range(len(group) - 1):
            gap_start = group[index][1]
            gap_end = group[index + 1][0]
            if 0 < gap_end - gap_start <= CAPTION_MAX_PAUSE:
                phrase = _base_phrase(group)
                lines.append(
                    f"Dialogue: 0,{_ass_time(gap_start)},{_ass_time(gap_end)},"
                    f"Caption,,0,0,0,{phrase}"
                )

    if not groups:
        for segment in segments:
            start = max(segment.start, candidate.start) - candidate.start
            end = min(segment.end, candidate.end) - candidate.start
            text = _ass_escape(" ".join(segment.text.split()).upper())
            if end > start and text:
                lines.append(f"Dialogue: 0,{_ass_time(start)},{_ass_time(end)},Caption,,0,0,0,{text}")

    output.write_text("\n".join(lines), encoding="utf-8")
    return output


def render_vertical(source: Path, candidate: ClipCandidate, output: Path,
                    segments: list[TranscriptSegment], caption_style: str = "karaoke") -> Path:
    output.parent.mkdir(parents=True, exist_ok=True)
    subtitle_file = output.with_suffix(".ass")
    _write_ass(candidate, segments, subtitle_file, caption_style)

    subtitle_path = str(subtitle_file.resolve()).replace("\\", "/").replace(":", "\\:")
    vf = (
        "scale=1080:1920:force_original_aspect_ratio=increase,"
        "crop=1080:1920,setsar=1,fps=30,"
        f"ass='{subtitle_path}'"
    )

    cmd = [
        "ffmpeg", "-y", "-ss", f"{candidate.start:.3f}", "-i", str(source),
        "-t", f"{candidate.duration:.3f}", "-vf", vf,
        # Stage 3: favor wall-clock time on the GitHub-hosted CPU runner. CRF 20
        # keeps the visual quality stable while veryfast avoids spending most of
        # the job on x264 motion estimation. Two FFmpeg workers run in parallel
        # from the pipeline, so cap each encoder to two threads.
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-threads", "2", "-maxrate", "20M", "-bufsize", "40M",
        "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-movflags", "+faststart", str(output),
    ]
    subprocess.run(cmd, check=True)
    return output
