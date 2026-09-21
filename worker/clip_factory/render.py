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


PRESETS = {
    # Position is intentionally in the lower-middle safe zone, never vertically centered.
    "karaoke": dict(font="DejaVu Sans", size=76, bold=1, primary="&H00FFFFFF",
                   active="&H0000D7FF", outline=5, shadow=2, margin=440, spacing=0,
                   alignment=2, scale_x=100, scale_y=100),
    "fire": dict(font="DejaVu Sans Condensed", size=82, bold=1, primary="&H00FFFFFF",
                 active="&H00004DFF", outline=7, shadow=4, margin=420, spacing=-1,
                 alignment=2, scale_x=100, scale_y=100),
    "beasty": dict(font="DejaVu Sans Mono", size=86, bold=1, primary="&H00FFFFFF",
                   active="&H0000B5FF", outline=8, shadow=4, margin=455, spacing=-2,
                   alignment=2, scale_x=105, scale_y=100),
    "youshaei": dict(font="DejaVu Sans", size=72, bold=1, primary="&H00FFFFFF",
                    active="&H00D7FF", outline=3, shadow=1, margin=475, spacing=0,
                    alignment=2, scale_x=100, scale_y=100),
    "harmozi": dict(font="DejaVu Sans Condensed", size=80, bold=1, primary="&H00FFFFFF",
                    active="&H0000A5FF", outline=5, shadow=3, margin=430, spacing=-1,
                    alignment=2, scale_x=100, scale_y=100),
    "cinematic": dict(font="DejaVu Serif", size=62, bold=0, primary="&H00FFFFFF",
                      active="&H00FFFFFF", outline=2, shadow=2, margin=500, spacing=2,
                      alignment=2, scale_x=100, scale_y=100),
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
        projected = chars + len(word[2]) + (1 if current else 0)
        if current and (len(current) >= max_words or projected > max_chars):
            groups.append(current)
            current, chars = [], 0
        current.append(word)
        chars += len(word[2]) + (1 if chars else 0)
    if current:
        groups.append(current)
    return groups


def _event_text(group, style: str) -> str:
    p = PRESETS.get(style, PRESETS["karaoke"])
    pieces = []

    for _, (ws, we, raw_text) in enumerate(group):
        duration_cs = max(1, round((we - ws) * 100))
        text = _ass_escape(raw_text.upper())

        if style == "karaoke":
            pieces.append(f"{{\\c{p['active']}\\k{duration_cs}}}{text}{{\\c{p['primary']}}}")

        elif style == "fire":
            pieces.append(
                f"{{\\c{p['active']}\\bord9\\shad4\\fscx116\\fscy116"
                f"\\t(0,100,\\fscx100\\fscy100)\\k{duration_cs}}}{text}"
                f"{{\\c{p['primary']}\\bord7}}"
            )

        elif style == "beasty":
            # Block/punch style: active words become oversized with a dark backing.
            pieces.append(
                f"{{\\c{p['active']}\\3c&H000000&\\bord10\\shad5"
                f"\\fscx122\\fscy115\\t(0,120,\\fscx105\\fscy100)\\k{duration_cs}}}{text}"
                f"{{\\c{p['primary']}\\bord8}}"
            )

        elif style == "youshaei":
            # Clean editorial: thin cyan underline and restrained emphasis.
            pieces.append(
                f"{{\\c{p['active']}\\u1\\bord2\\k{duration_cs}}}{text}"
                f"{{\\c{p['primary']}\\u0}}"
            )

        elif style == "harmozi":
            # Motivational card-like emphasis: bright active word with heavy black keyline.
            pieces.append(
                f"{{\\c{p['active']}\\3c&H000000&\\bord8\\shad3"
                f"\\fscx110\\fscy110\\k{duration_cs}}}{text}"
                f"{{\\c{p['primary']}\\fscx100\\fscy100}}"
            )

        else:
            # Cinematic: understated serif, spaced lettering and soft reveal.
            pieces.append(
                f"{{\\alpha&H55&\\fscx96\\k{duration_cs}}}{text}"
                f"{{\\alpha&H00&\\fscx100\\t(0,180,\\fscx100)}}"
            )

    if style == "beasty":
        return "  ".join(pieces)
    if style == "cinematic":
        return " ".join(pieces)
    return " ".join(pieces)


def _write_ass(candidate: ClipCandidate, segments: list[TranscriptSegment], output: Path, style: str) -> Path:
    p = PRESETS.get(style, PRESETS["karaoke"])

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
            f"Style: Caption,{p['font']},{p['size']},{p['primary']},{p['primary']},"
            f"&H00000000,&HCC000000,{p['bold']},0,0,0,{p['scale_x']},{p['scale_y']},"
            f"{p['spacing']},0,1,{p['outline']},{p['shadow']},{p['alignment']},"
            f"70,70,{p['margin']},1"
        ),
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, Effect, Text",
    ]

    words = _word_events(candidate, segments)
    groups = _group_words(words, style)

    for group in groups:
        start, end = group[0][0], group[-1][1]
        lines.append(f"Dialogue: 0,{_ass_time(start)},{_ass_time(end)},Caption,,0,0,0,{_event_text(group, style)}")

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
        "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-maxrate", "20M", "-bufsize", "40M",
        "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-movflags", "+faststart", str(output),
    ]
    subprocess.run(cmd, check=True)
    return output
