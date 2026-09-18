from __future__ import annotations

import re
from typing import Iterable

from .models import ClipCandidate, TranscriptSegment

HOOK_WORDS = {
    "como", "por que", "porque", "segredo", "erro", "nunca", "sempre", "importante",
    "problema", "solução", "dica", "atenção", "cuidado", "descobri", "descoberta",
    "melhor", "pior", "diferença", "resultado", "verdade", "mito", "exemplo",
    "primeiro", "segundo", "terceiro", "acontece", "significa", "funciona",
}

INTRO_WORDS = {
    "olá", "oi", "bom dia", "boa tarde", "boa noite", "sejam bem-vindos",
    "bem vindos", "vamos começar", "começando", "começamos",
}


def _words(text: str) -> list[str]:
    return re.findall(r"[\wÀ-ÿ]+", text.lower())


def _score_window(text: str, start: float, end: float) -> float:
    words = _words(text)
    if not words:
        return 0.0

    score = min(len(words), 180) * 0.18
    score += min(text.count("?") * 7, 21)
    score += min(text.count("!") * 5, 15)
    score += min(sum(1 for w in words if w in HOOK_WORDS) * 3.5, 28)
    score += min(text.count(".") * 0.8, 12)

    lower = text.lower()
    if any(lower.startswith(word) for word in INTRO_WORDS):
        score -= 18
    if len(words) < 35:
        score -= 12
    if len(words) > 240:
        score -= 8
    if text.rstrip().endswith((",", ":", ";", "-")):
        score -= 10

    return score


def _make_windows(
    segments: list[TranscriptSegment],
    min_duration: int,
    max_duration: int,
) -> Iterable[tuple[float, float, str]]:
    if not segments:
        return

    n = len(segments)
    for i in range(n):
        start = segments[i].start
        for j in range(i, n):
            end = segments[j].end
            duration = end - start
            if duration < min_duration:
                continue
            if duration > max_duration:
                break
            text = " ".join(s.text.strip() for s in segments[i : j + 1]).strip()
            if text:
                yield start, end, text


def _title(text: str) -> str:
    sentence = re.split(r"(?<=[.!?])\s+", text.strip())[0]
    sentence = re.sub(r"\s+", " ", sentence)
    if len(sentence) > 72:
        sentence = sentence[:69].rsplit(" ", 1)[0] + "..."
    return sentence or "Clip"


def _hook(text: str) -> str:
    words = text.split()
    hook = " ".join(words[:14])
    if len(words) > 14:
        hook += "..."
    return hook


def _candidate(start: float, end: float, text: str, target: float) -> ClipCandidate:
    duration = end - start
    duration_bonus = max(0.0, 12.0 - abs(duration - target) * 0.25)
    score = _score_window(text, start, end) + duration_bonus
    return ClipCandidate(
        start,
        end,
        _title(text),
        _hook(text),
        "Seleção local por densidade de conteúdo, frases completas e diversidade temporal.",
        round(score, 2),
        text,
    )


def _overlap_ratio(a: ClipCandidate, b: ClipCandidate) -> float:
    overlap = max(0.0, min(a.end, b.end) - max(a.start, b.start))
    shorter = min(a.duration, b.duration)
    return overlap / shorter if shorter else 0.0


def select_clips(
    provider: str,
    segments: list[TranscriptSegment],
    count: int,
    min_duration: int,
    max_duration: int,
    settings,
) -> list[ClipCandidate]:
    if provider not in {"local", "heuristic", "ollama"}:
        raise ValueError("Paid AI providers are disabled. Use provider=local.")

    target = (min_duration + max_duration) / 2
    candidates = [
        _candidate(start, end, text, target)
        for start, end, text in _make_windows(segments, min_duration, max_duration)
    ]
    candidates.sort(key=lambda c: c.score, reverse=True)

    selected: list[ClipCandidate] = []

    # First pass: prioritize quality while strongly reducing duplicate/overlapping clips.
    for candidate in candidates:
        if any(_overlap_ratio(candidate, chosen) >= 0.30 for chosen in selected):
            continue
        selected.append(candidate)
        if len(selected) >= count:
            return selected

    # Second pass: if the transcript is sparse, relax the overlap constraint so the
    # requested number can still be produced when there are distinct candidate windows.
    for candidate in candidates:
        if candidate in selected:
            continue
        if any(_overlap_ratio(candidate, chosen) >= 0.70 for chosen in selected):
            continue
        selected.append(candidate)
        if len(selected) >= count:
            break

    return selected
