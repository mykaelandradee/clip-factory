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
        for word in segment.words:
            start = float(word["start"])
            end = float(word["end"])
            if end <= candidate.start or start >= candidate.end:
                continue
            text = str(word.get("text", "")).strip()
            if text:
                events.append((
                    max(start, candidate.start) - candidate.start,
                    min(end, candidate.end) - candidate.start,
                    text,
                ))
    return events


def _group_words(words: list[tuple[float, float, str]], max_words: int = 3, max_chars: int = 28):
    groups = []
    current = []
    chars = 0
    for word in words:
        projected = chars + len(word[2]) + (1 if current else 0)
        if current and (len(current) >= max_words or projected > max_chars):
            groups.append(current)
            current = []
            chars = 0
        current.append(word)
        chars += len(word[2]) + (1 if chars else 0)
    if current:
        groups.append(current)
    return groups


def _write_ass(
    candidate: ClipCandidate,
    segments: list[TranscriptSegment],
    output: Path,
    style: str,
) -> Path:
    presets = {
        "karaoke": dict(font_size=78, primary="&H00FFFFFF", secondary="&H00FFFFFF", outline=6, bold=1, active="&H0000D7FF", margin_v=300, spacing=0),
        "fire": dict(font_size=82, primary="&H00FFFFFF", secondary="&H00FFFFFF", outline=7, bold=1, active="&H00004DFF", margin_v=300, spacing=0),
        "beasty": dict(font_size=86, primary="&H00FFFFFF", secondary="&H00FFFFFF", outline=8, bold=1, active="&H0000B5FF", margin_v=285, spacing=-1),
        "youshaei": dict(font_size=74, primary="&H00FFFFFF", secondary="&H00FFFFFF", outline=6, bold=1, active="&H0000D7FF", margin_v=315, spacing=0),
        "harmozi": dict(font_size=80, primary="&H00FFFFFF", secondary="&H00FFFFFF", outline=6, bold=1, active="&H0000A5FF", margin_v=300, spacing=0),
        "cinematic": dict(font_size=66, primary="&H00FFFFFF", secondary="&H00FFFFFF", outline=4, bold=0, active="&H00FFFFFF", margin_v=330, spacing=1),
    }
    preset = presets.get(style, presets["karaoke"])

    lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        "PlayResX: 1080",
        "PlayResY: 1920",
        "WrapStyle: 2",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        f"Style: Caption,DejaVu Sans,{preset['font_size']},{preset['primary']},{preset['secondary']},&H00000000,&HCC000000,{preset['bold']},0,0,0,100,100,{preset['spacing']},0,1,{preset['outline']},3,2,90,90,{preset['margin_v']},1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, Effect, Text",
    ]

    words = _word_events(candidate, segments)
    groups = _group_words(words)

    for group in groups:
        start, end = group[0][0], group[-1][1]
        pieces = []
        for ws, we, text in group:
            duration_cs = max(1, round((we - ws) * 100))
            escaped = _ass_escape(text.upper())
            if style == "cinematic":
                pieces.append(f"{{\\k{duration_cs}}}{escaped}")
            else:
                pieces.append(f"{{\\c{preset['active']}\\k{duration_cs}}}{escaped}{{\\c{preset['primary']}}}")
        text = " ".join(pieces)
        lines.append(f"Dialogue: 0,{_ass_time(start)},{_ass_time(end)},Caption,,0,0,0,{text}")

    if not groups:
        for segment in segments:
            start = max(segment.start, candidate.start) - candidate.start
            end = min(segment.end, candidate.end) - candidate.start
            text = _ass_escape(" ".join(segment.text.split()).upper())
            if end > start and text:
                lines.append(f"Dialogue: 0,{_ass_time(start)},{_ass_time(end)},Caption,,0,0,0,{text}")

    output.write_text("\n".join(lines), encoding="utf-8")
    return output


def render_vertical(
    source: Path,
    candidate: ClipCandidate,
    output: Path,
    segments: list[TranscriptSegment],
    caption_style: str = "karaoke",
) -> Path:
    """Render a 9:16 MP4 with social-style captions."""
    output.parent.mkdir(parents=True, exist_ok=True)
    subtitle_file = output.with_suffix(".ass")
    _write_ass(candidate, segments, subtitle_file, caption_style)

    subtitle_path = str(subtitle_file.resolve()).replace("\\", "/").replace(":", "\\:")
    vf = (
        "scale=1080:1920:force_original_aspect_ratio=increase,"
        "crop=1080:1920,setsar=1,"
        f"ass='{subtitle_path}'"
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
