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

FILLER_WORDS = {
    "tipo", "assim", "basicamente", "né", "então", "bom", "enfim",
    "uh", "um", "ah", "you know", "like",
}

WEAK_STARTS = {
    "e", "mas", "aí", "daí", "porque", "que", "então", "só que",
}

STRONG_STARTS = {
    "como", "por que", "o problema", "a verdade", "o segredo",
    "ninguém", "você", "vocês", "se", "quando", "antes", "depois",
    "descobri", "aprendi", "existem", "existe",
}



def _words(text: str) -> list[str]:
    return re.findall(r"[\wÀ-ÿ]+", text.lower())


def _score_window(text: str, start: float, end: float) -> float:
    words = _words(text)
    if not words:
        return 0.0

    duration = max(1.0, end - start)
    words_per_second = len(words) / duration
    score = min(len(words), 180) * 0.18
    score += min(text.count("?") * 7, 21)
    score += min(text.count("!") * 5, 15)
    score += min(sum(1 for w in words if w in HOOK_WORDS) * 3.5, 28)
    score += min(text.count(".") * 1.5, 15)

    lower = text.lower()
    if any(lower.startswith(word) for word in INTRO_WORDS):
        score -= 18

    filler_count = sum(1 for word in words if word in FILLER_WORDS)
    score -= min(filler_count * 1.8, 12)

    first_words = " ".join(words[:4])
    if any(first_words.startswith(word) for word in STRONG_STARTS):
        score += 7
    if any(first_words.startswith(word) for word in WEAK_STARTS):
        score -= 5

    # Prefer windows that open and close on a complete thought.
    if text[:1].islower():
        score -= 4
    if len(words) < 35:
        score -= 12
    if len(words) > 240:
        score -= 8
    if text.rstrip().endswith((",", ":", ";", "-")):
        score -= 10
    if text.rstrip().endswith((".", "!", "?")):
        score += 10
    if 1.6 <= words_per_second <= 3.6:
        score += 5

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
    # Keep the quality score useful without making the longest allowed clips
    # systematically win just because they contain more words.
    duration_bonus = max(0.0, 10.0 - abs(duration - target) * 0.35)
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

    # Whisper can return short speech segments separated by silence. In that
    # case a strict segment-boundary window may produce no 30–60s candidate
    # even though the source contains enough spoken material. Build fallback
    # windows from the timeline while keeping the actual caption gaps intact.
    if not candidates and segments:
        timeline_start = segments[0].start
        timeline_end = segments[-1].end
        cursor = timeline_start
        step = max(4.0, target * 0.55)
        while cursor + min_duration <= timeline_end + 0.05:
            desired_end = min(cursor + target, timeline_end)
            max_end = min(cursor + max_duration, timeline_end)
            if desired_end - cursor < min_duration:
                desired_end = min_end = cursor + min_duration
            else:
                min_end = desired_end
            end = min(max_end, max(desired_end, min_end))
            window_segments = [
                s for s in segments
                if s.end > cursor and s.start < end
            ]
            text = " ".join(s.text.strip() for s in window_segments).strip()
            if text and end - cursor >= min_duration:
                candidates.append(_candidate(cursor, end, text, target))
            cursor += step

    candidates.sort(key=lambda c: c.score, reverse=True)

    selected: list[ClipCandidate] = []

    def lexical_similarity(a: ClipCandidate, b: ClipCandidate) -> float:
        left = set(_words(a.transcript))
        right = set(_words(b.transcript))
        if not left or not right:
            return 0.0
        return len(left & right) / max(1, len(left | right))

    if not candidates:
        return selected[:count]

    # Rotate through short, medium and long targets instead of letting the
    # highest-density windows all converge on max_duration.
    span = max(0, max_duration - min_duration)
    duration_ratios = {
        1: [0.50],
        2: [0.00, 1.00],
        3: [0.00, 0.50, 1.00],
        4: [0.00, 0.33, 0.67, 1.00],
        5: [0.00, 0.33, 0.67, 1.00, 0.33],
        6: [0.00, 0.33, 0.67, 1.00, 0.33, 0.67],
        7: [0.00, 0.33, 0.67, 1.00, 0.00, 0.50, 1.00],
        8: [0.00, 0.33, 0.67, 1.00, 0.00, 0.50, 1.00, 0.33],
        9: [0.00, 0.33, 0.67, 1.00, 0.00, 0.50, 1.00, 0.33, 0.67],
        10: [0.00, 0.33, 0.67, 1.00, 0.00, 0.50, 1.00, 0.33, 0.67, 0.00],
        15: [0.00, 0.33, 0.67, 1.00, 0.00, 0.50, 1.00, 0.33, 0.67, 0.00, 0.50, 1.00, 0.33, 0.67, 0.00],
    }
    ratios = duration_ratios.get(count, [0.00, 0.50, 1.00])
    duration_targets = [min_duration + span * ratio for ratio in ratios]

    # First pass: maximize quality while keeping clips meaningfully separate.
    # A timeline spread bonus prevents all clips from coming from one hot spot.
    timeline_end = max(c.end for c in candidates)
    timeline_start = min(c.start for c in candidates)
    timeline_span = max(1.0, timeline_end - timeline_start)

    remaining = candidates[:]
    while remaining and len(selected) < count:
        best = None
        best_score = float("-inf")
        preferred_duration = duration_targets[min(len(selected), len(duration_targets) - 1)]
        for candidate in remaining:
            spread_bonus = 0.0
            duration_diversity_bonus = max(
                0.0,
                16.0 - abs(candidate.duration - preferred_duration) * 0.55,
            )
            if selected:
                nearest = min(
                    abs(candidate.start - chosen.start) for chosen in selected
                )
                spread_bonus = min(nearest / timeline_span * 24.0, 12.0)
            overlap_penalty = 0.0
            similarity_penalty = 0.0
            if selected:
                overlap_penalty = max(
                    _overlap_ratio(candidate, chosen) for chosen in selected
                ) * 24.0
                similarity_penalty = max(
                    lexical_similarity(candidate, chosen) for chosen in selected
                ) * 18.0
            adjusted = (
                candidate.score
                + spread_bonus
                + duration_diversity_bonus
                - overlap_penalty
                - similarity_penalty
            )
            if adjusted > best_score:
                best = candidate
                best_score = adjusted

        if best is None:
            break
        selected.append(best)
        remaining.remove(best)

        if all(_overlap_ratio(best, other) >= 0.30 for other in remaining):
            break

    # Short videos may not have enough non-overlapping material. Relax overlap,
    # but still avoid near-duplicates and keep the requested count when possible.
    for candidate in candidates:
        if len(selected) >= count:
            break
        if candidate in selected:
            continue
        if any(_overlap_ratio(candidate, chosen) >= 0.70 for chosen in selected):
            continue
        selected.append(candidate)

    # Last resort: satisfy the requested count with different candidate windows.
    # This can create intentionally overlapping clips, but avoids silently returning
    # fewer clips when the source has enough transcript material for additional windows.
    for candidate in candidates:
        if candidate in selected:
            continue
        if any(
            abs(candidate.start - chosen.start) < 5
            and abs(candidate.end - chosen.end) < 5
            for chosen in selected
        ):
            continue
        selected.append(candidate)
        if len(selected) >= count:
            break

    # Fallback: synthesize broader windows when transcript boundaries are sparse.
    if len(selected) < count and segments:
        total_start = segments[0].start
        total_end = segments[-1].end
        span = total_end - total_start
        if span >= min_duration:
            step = max(6.0, target * 0.45)
            start = total_start
            forced: list[ClipCandidate] = []
            while start < total_end - min_duration + 0.1:
                desired_end = min(start + target, total_end)
                valid_end = max((s.end for s in segments if s.end >= desired_end), default=total_end)
                end = min(valid_end, start + max_duration)
                if end - start >= min_duration:
                    text = " ".join(s.text.strip() for s in segments if s.end > start and s.start < end).strip()
                    if text:
                        forced.append(_candidate(start, end, text, target))
                start += step
            forced.sort(key=lambda c: c.score, reverse=True)
            for candidate in forced:
                if any(abs(candidate.start - chosen.start) < 4 and abs(candidate.end - chosen.end) < 4 for chosen in selected):
                    continue
                selected.append(candidate)
                if len(selected) >= count:
                    break

    # Hard safety: never return more clips than the job requested.
    return selected[:count]
