from __future__ import annotations

import gc
import json
import os
from pathlib import Path

os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("NUMEXPR_NUM_THREADS", "1")

from .models import TranscriptSegment


def _translate_to_pt(texts: list[str]) -> list[str]:
    from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

    if not texts:
        return []

    tokenizer = AutoTokenizer.from_pretrained("Helsinki-NLP/opus-mt-tc-big-en-pt")
    model = AutoModelForSeq2SeqLM.from_pretrained("Helsinki-NLP/opus-mt-tc-big-en-pt")

    translated: list[str] = []
    try:
        for start in range(0, len(texts), 8):
            batch = texts[start : start + 8]
            inputs = tokenizer(
                batch,
                return_tensors="pt",
                padding=True,
                truncation=True,
                max_length=512,
            )
            output_ids = model.generate(
                **inputs,
                max_new_tokens=256,
                num_beams=4,
            )
            decoded = tokenizer.batch_decode(output_ids, skip_special_tokens=True)
            translated.extend(str(text).strip() for text in decoded)
    finally:
        del model
        del tokenizer
        gc.collect()

    return translated


def _retime_translated_words(text: str, start: float, end: float) -> list[dict]:
    tokens = text.split()
    if not tokens:
        return []

    duration = max(0.1, end - start)
    step = duration / len(tokens)
    return [
        {
            "start": start + (index * step),
            "end": start + ((index + 1) * step),
            "text": token,
        }
        for index, token in enumerate(tokens)
    ]


def transcribe(
    video_path: Path,
    output_json: Path,
    model_name: str,
    subtitle_language: str = "original",
) -> list[TranscriptSegment]:
    """Transcribe with Whisper and optionally translate captions to PT-BR locally."""
    import whisper

    if subtitle_language not in {"original", "pt-BR", "en"}:
        raise ValueError("Idioma de legenda não suportado.")

    model = whisper.load_model(model_name, device="cpu")
    try:
        task = "translate" if subtitle_language == "en" else "transcribe"
        result = model.transcribe(
            str(video_path),
            verbose=False,
            fp16=False,
            temperature=0,
            condition_on_previous_text=False,
            word_timestamps=True,
            task=task,
        )
    finally:
        del model
        gc.collect()

    raw_segments = [raw for raw in result.get("segments", []) if raw.get("text", "").strip()]
    detected_language = str(result.get("language", "")).lower()
    is_translated_to_pt = subtitle_language == "pt-BR" and detected_language not in {"pt", "pt-br"}

    if is_translated_to_pt:
        translated = _translate_to_pt([str(raw["text"]).strip() for raw in raw_segments])
    else:
        translated = [str(raw["text"]).strip() for raw in raw_segments]

    segments: list[TranscriptSegment] = []
    for raw, text in zip(raw_segments, translated):
        if is_translated_to_pt:
            words = _retime_translated_words(
                text,
                float(raw["start"]),
                float(raw["end"]),
            )
        else:
            words = []
            for word in raw.get("words", []) or []:
                word_text = str(word.get("word", "")).strip()
                if not word_text:
                    continue
                words.append({
                    "start": float(word.get("start", raw["start"])),
                    "end": float(word.get("end", raw["end"])),
                    "text": word_text,
                })

        segments.append(
            TranscriptSegment(
                float(raw["start"]), float(raw["end"]), text, words
            )
        )

    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(
        json.dumps([s.__dict__ for s in segments], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return segments
