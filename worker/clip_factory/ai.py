from __future__ import annotations

import re
from typing import Iterable

from .models import ClipCandidate, TranscriptSegment

# Local, dependency-free clip selector. It deliberately does not call any paid API.
# The score is a heuristic for finding self-contained, information-dense moments.
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

    # Slight preference for clips around the requested range's middle is applied
    # by the caller; this base score only measures textual potential.
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


def select_clips(
    provider: str,
    segments: list[TranscriptSegment],
    count: int,
    min_duration: int,
    max_duration: int,
    settings,
) -> list[ClipCandidate]:
    # Keep the provider argument for API compatibility, but local selection is
    # the only supported mode so this worker never incurs API charges.
    if provider not in {"local", "heuristic", "ollama"}:
        raise ValueError("Paid AI providers are disabled. Use provider=local.")

    candidates: list[ClipCandidate] = []
    target = (min_duration + max_duration) / 2
    for start, end, text in _make_windows(segments, min_duration, max_duration):
        duration = end - start
        duration_bonus = max(0.0, 12.0 - abs(duration - target) * 0.25)
        score = _score_window(text, start, end) + duration_bonus
        candidates.append(
            ClipCandidate(
                start,
                end,
                _title(text),
                _hook(text),
                "Seleção local por densidade de conteúdo, frases completas e sinais de gancho.",
                round(score, 2),
                text,
            )
        )

    candidates.sort(key=lambda c: c.score, reverse=True)

    selected: list[ClipCandidate] = []
    for candidate in candidates:
        # Avoid returning several nearly identical overlapping windows.
        overlaps = False
        for chosen in selected:
            overlap = max(0.0, min(candidate.end, chosen.end) - max(candidate.start, chosen.start))
            shorter = min(candidate.end - candidate.start, chosen.end - chosen.start)
            if shorter and overlap / shorter >= 0.45:
                overlaps = True
                break
        if not overlaps:
            selected.append(candidate)
        if len(selected) >= count:
            break

    return selected
