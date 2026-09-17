from __future__ import annotations

import json
import re
from typing import Any

from .models import ClipCandidate, TranscriptSegment

SYSTEM_PROMPT = """You select short-form video clips from a timestamped transcript.
Return ONLY valid JSON with this shape:
{"clips":[{"start":0,"end":30,"title":"...","hook":"...","reason":"...","score":0-100}]}
Choose self-contained moments with a strong opening, useful/interesting content, emotional payoff,
clear context, or a surprising statement. Avoid intros, greetings, ads, long pauses and incomplete thoughts.
Respect the requested duration range. Scores are editorial potential, not factual truth.
"""


def _transcript_text(segments: list[TranscriptSegment]) -> str:
    return "\n".join(f"[{s.start:.2f}-{s.end:.2f}] {s.text}" for s in segments)


def _parse_json(text: str) -> dict[str, Any]:
    cleaned = text.strip().replace("```json", "").replace("```", "").strip()
    match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    if not match:
        raise ValueError("AI response did not contain a JSON object")
    return json.loads(match.group(0))


def _build_candidates(data: dict[str, Any], segments: list[TranscriptSegment], min_duration: int, max_duration: int, limit: int) -> list[ClipCandidate]:
    result: list[ClipCandidate] = []
    for item in data.get("clips", []):
        try:
            start = float(item["start"])
            end = float(item["end"])
            if end <= start or not (min_duration <= end - start <= max_duration):
                continue
            text = " ".join(s.text for s in segments if s.end > start and s.start < end).strip()
            result.append(ClipCandidate(start, end, str(item.get("title", "Clip")), str(item.get("hook", "")), str(item.get("reason", "")), float(item.get("score", 0)), text))
        except (KeyError, TypeError, ValueError):
            continue
    return sorted(result, key=lambda c: c.score, reverse=True)[:limit]


def select_clips(provider: str, segments: list[TranscriptSegment], count: int, min_duration: int, max_duration: int, settings) -> list[ClipCandidate]:
    prompt = f"{SYSTEM_PROMPT}\nRequested number: {count}\nDuration: {min_duration}-{max_duration} seconds\nTranscript:\n{_transcript_text(segments)}"
    if provider == "openai":
        if not settings.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY is not configured")
        from openai import OpenAI
        client = OpenAI(api_key=settings.openai_api_key)
        response = client.responses.create(model=settings.openai_model, input=prompt)
        text = response.output_text
    elif provider == "anthropic":
        if not settings.anthropic_api_key:
            raise RuntimeError("ANTHROPIC_API_KEY is not configured")
        from anthropic import Anthropic
        client = Anthropic(api_key=settings.anthropic_api_key)
        response = client.messages.create(model=settings.anthropic_model, max_tokens=4000, system=SYSTEM_PROMPT, messages=[{"role": "user", "content": prompt}])
        text = "".join(block.text for block in response.content if getattr(block, "type", None) == "text")
    elif provider == "ollama":
        import requests
        response = requests.post(f"{settings.ollama_url.rstrip('/')}/api/generate", json={"model": settings.ollama_model, "prompt": prompt, "stream": False}, timeout=300)
        response.raise_for_status()
        text = response.json()["response"]
    else:
        raise ValueError(f"Unsupported AI provider: {provider}")
    return _build_candidates(_parse_json(text), segments, min_duration, max_duration, count)
