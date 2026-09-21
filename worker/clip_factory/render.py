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
    # Colors use ASS AABBGGRR notation so they match the UI previews.
    "karaoke": dict(font="DejaVu Sans", size=76, bold=1, primary="&H00FFFFFF",
                   active="&H0000D7FF", outline=5, shadow=2, margin=440, spacing=0,
                   alignment=2, scale_x=100, scale_y=100),
    "fire": dict(font="DejaVu Sans Condensed", size=82, bold=1, primary="&H00FFFFFF",
                 active="&H00004DFF", outline=7, shadow=4, margin=420, spacing=-1,
                 alignment=2, scale_x=100, scale_y=100),
    "beasty": dict(font="DejaVu Sans Mono", size=86, bold=1, primary="&H00FFFFFF",
                   active="&H00000000", outline=8, shadow=4, margin=455, spacing=-2,
                   alignment=2, scale_x=105, scale_y=100),
    "youshaei": dict(font="DejaVu Sans", size=72, bold=1, primary="&H00FFFFFF",
                    active="&H00FFE78F", outline=3, shadow=1, margin=475, spacing=0,
                    alignment=2, scale_x=100, scale_y=100),
    "harmozi": dict(font="DejaVu Sans Condensed", size=80, bold=1, primary="&H00FFFFFF",
                    active="&H0037FFD8", outline=5, shadow=3, margin=430, spacing=-1,
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
            pieces.append(
                f"{{\\c{p['active']}\\k{duration_cs}}}{text}"
                f"{{\\c{p['primary']}}}"
            )
        elif style == "fire":
            pieces.append(
                f"{{\\c{p['active']}\\bord9\\shad4"
                f"\\fscx116\\fscy116\\k{duration_cs}"
                f"\\t(0,120,\\fscx100\\fscy100)}}{text}"
                f"{{\\c{p['primary']}\\bord7\\shad4}}"
            )
        elif style == "beasty":
            pieces.append(
                f"{{\\c{p['primary']}\\3c&H00000000&\\bord7\\shad0\\k{duration_cs}}}{text}"
                f"{{\\c{p['primary']}\\3c&H00000000&\\bord7}}"
            )
        elif style == "youshaei":
            pieces.append(
                f"{{\\c{p['active']}\\bord2\\shad1\\k{duration_cs}}}{text}"
                f"{{\\c{p['primary']}\\bord3\\shad1}}"
            )
        elif style == "harmozi":
            pieces.append(
                f"{{\\c{p['active']}\\3c&H000000&\\bord8\\shad3"
                f"\\fscx112\\fscy112\\k{duration_cs}}}{text}"
                f"{{\\c{p['primary']}\\fscx100\\fscy100}}"
            )
        else:
            pieces.append(
                f"{{\\alpha&H55&\\fscx96\\k{duration_cs}}}{text}"
                f"{{\\alpha&H00&\\fscx100}}"
            )

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
        (
            f"Style: BeastyBox,{p['font']},{p['size']},&H00000000,&H00000000,"
            f"&H00000000,&H00FFFFFF,{p['bold']},0,0,0,105,100,{p['spacing']},0,3,0,0,2,"
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

        if style == "beasty":
            # DejaVu Sans Mono makes character width predictable enough to
            # place the active word over the same centered base caption.
            char_width = p["size"] * 0.60 * (p["scale_x"] / 100)
            space_width = char_width
            word_widths = [len(raw_word) * char_width for _, _, raw_word in group]
            total_width = sum(word_widths)
            total_width += max(0, len(group) - 1) * (space_width + (p["spacing"] or 0))
            cursor = -total_width / 2
            for (word_start, word_end, raw_word), word_width in zip(group, word_widths):
                word_center = cursor + (word_width / 2)
                x = max(70, min(1010, 540 + word_center))
                y = 1920 - p["margin"]
                word_text = _ass_escape(raw_word.upper())
                lines.append(
                    f"Dialogue: 1,{_ass_time(word_start)},{_ass_time(word_end)},"
                    f"BeastyBox,,0,0,0,{{\\pos({x:.0f},{y:.0f})}}{word_text}"
                )
                cursor += word_width + space_width + (p["spacing"] or 0)

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
