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


def _group_words(
    words: list[tuple[float, float, str]],
    max_words: int = 3,
    max_chars: int = 26,
):
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


# The presets intentionally have different typography, layout, motion and emphasis.
# They are inspired by common short-form caption conventions, not copied from any
# third-party implementation.
PRESETS = {
    "karaoke": dict(
        font="DejaVu Sans", size=76, bold=1, primary="&H00FFFFFF",
        active="&H0000D7FF", outline=5, shadow=2, margin=250, spacing=0,
        alignment=2, scale_x=100, scale_y=100, border=1,
    ),
    "fire": dict(
        font="DejaVu Sans", size=80, bold=1, primary="&H00FFFFFF",
        active="&H00004DFF", outline=7, shadow=4, margin=245, spacing=-1,
        alignment=2, scale_x=100, scale_y=100, border=1,
    ),
    "beasty": dict(
        font="DejaVu Sans", size=88, bold=1, primary="&H00FFFFFF",
        active="&H0000B5FF", outline=9, shadow=4, margin=230, spacing=-2,
        alignment=5, scale_x=105, scale_y=100, border=1,
    ),
    "youshaei": dict(
        font="DejaVu Sans", size=72, bold=1, primary="&H00FFFFFF",
        active="&H00D7FF", outline=4, shadow=2, margin=270, spacing=0,
        alignment=2, scale_x=100, scale_y=100, border=1,
    ),
    "harmozi": dict(
        font="DejaVu Sans", size=78, bold=1, primary="&H00FFFFFF",
        active="&H0000A5FF", outline=5, shadow=3, margin=255, spacing=-1,
        alignment=2, scale_x=100, scale_y=100, border=1,
    ),
    "cinematic": dict(
        font="DejaVu Sans", size=64, bold=0, primary="&H00FFFFFF",
        active="&H00FFFFFF", outline=3, shadow=2, margin=300, spacing=2,
        alignment=2, scale_x=100, scale_y=100, border=1,
    ),
}


def _event_text(group, style: str) -> str:
    preset = PRESETS.get(style, PRESETS["karaoke"])
    pieces = []

    for index, (ws, we, raw_text) in enumerate(group):
        duration_cs = max(1, round((we - ws) * 100))
        text = _ass_escape(raw_text.upper())

        if style == "karaoke":
            # Clean word-by-word fill, classic social caption behavior.
            pieces.append(
                f"{{\\c{preset['active']}\\k{duration_cs}}}{text}"
                f"{{\\c{preset['primary']}}}"
            )

        elif style == "fire":
            # Hot active word + scale/blur pop.
            pieces.append(
                f"{{\\c{preset['active']}\\bord8\\blur0.5\\fscx112\\fscy112"
                f"\\t(0,90,\\fscx100\\fscy100)\\k{duration_cs}}}{text}"
                f"{{\\c{preset['primary']}\\bord7}}"
            )

        elif style == "beasty":
            # Large block words, short punch-in and strong outline.
            pieces.append(
                f"{{\\c{preset['active']}\\fscx118\\fscy118\\bord10"
                f"\\t(0,110,\\fscx105\\fscy100)\\k{duration_cs}}}{text}"
                f"{{\\c{preset['primary']}\\bord9}}"
            )

        elif style == "youshaei":
            # Cleaner editorial style with a cyan active word.
            pieces.append(
                f"{{\\c{preset['active']}\\bord4\\shad2\\k{duration_cs}}}{text}"
                f"{{\\c{preset['primary']}}}"
            )

        elif style == "harmozi":
            # High-contrast motivational style: active word grows slightly.
            pieces.append(
                f"{{\\c{preset['active']}\\fscx108\\fscy108\\k{duration_cs}}}{text}"
                f"{{\\c{preset['primary']}\\t(0,80,\\fscx100\\fscy100)}}"
            )

        else:
            # Cinematic: restrained, smooth word reveal.
            pieces.append(
                f"{{\\alpha&H55&\\fscx96\\k{duration_cs}}}{text}"
                f"{{\\alpha&H00&\\fscx100\\t(0,140,\\alpha&H00&)}}"
            )

    return " ".join(pieces)


def _write_ass(
    candidate: ClipCandidate,
    segments: list[TranscriptSegment],
    output: Path,
    style: str,
) -> Path:
    preset = PRESETS.get(style, PRESETS["karaoke"])

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
        (
            f"Style: Caption,{preset['font']},{preset['size']},{preset['primary']},"
            f"{preset['primary']},&H00000000,&HCC000000,{preset['bold']},0,0,0,"
            f"{preset['scale_x']},{preset['scale_y']},{preset['spacing']},0,"
            f"{preset['border']},{preset['outline']},{preset['shadow']},{preset['alignment']},"
            f"75,75,{preset['margin']},1"
        ),
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, Effect, Text",
    ]

    words = _word_events(candidate, segments)
    groups = _group_words(words)

    for group in groups:
        start, end = group[0][0], group[-1][1]
        text = _event_text(group, style)
        lines.append(
            f"Dialogue: 0,{_ass_time(start)},{_ass_time(end)},Caption,,0,0,0,{text}"
        )

    if not groups:
        for segment in segments:
            start = max(segment.start, candidate.start) - candidate.start
            end = min(segment.end, candidate.end) - candidate.start
            text = _ass_escape(" ".join(segment.text.split()).upper())
            if end > start and text:
                lines.append(
                    f"Dialogue: 0,{_ass_time(start)},{_ass_time(end)},Caption,,0,0,0,{text}"
                )

    output.write_text("\n".join(lines), encoding="utf-8")
    return output


def render_vertical(
    source: Path,
    candidate: ClipCandidate,
    output: Path,
    segments: list[TranscriptSegment],
    caption_style: str = "karaoke",
) -> Path:
    """Render a 9:16 MP4 with distinct social caption presets."""
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
