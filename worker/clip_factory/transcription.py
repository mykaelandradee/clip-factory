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
    """Transcribe with Whisper and optionally translate captions to PT-BR locally.
    
    Uses deterministic beam decoding with conservative fallback temperatures and
    silence-aware timestamp handling. This improves recognition without adding
    a paid API dependency.
    """
    from faster_whisper import WhisperModel

    if subtitle_language not in {"original", "pt-BR", "en"}:
        raise ValueError("Idioma de legenda não suportado.")

    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    try:
        task = "translate" if subtitle_language == "en" else "transcribe"
        raw_segments, info = model.transcribe(
            str(video_path),
            task=task,
            beam_size=5,
            temperature=0.0,
            condition_on_previous_text=False,
            word_timestamps=True,
            vad_filter=True,
            vad_parameters={
                "threshold": 0.65,
                "min_speech_duration_ms": 250,
                "min_silence_duration_ms": 450,
                "speech_pad_ms": 120,
            },
        )
        raw_segments = list(raw_segments)
    finally:
        del model
        gc.collect()

    raw_segments = [raw for raw in raw_segments if str(raw.text).strip()]
    detected_language = str(getattr(info, "language", "")).lower()
    is_translated_to_pt = subtitle_language == "pt-BR" and detected_language not in {"pt", "pt-br"}

    if is_translated_to_pt:
        translated = _translate_to_pt([str(raw.text).strip() for raw in raw_segments])
    else:
        translated = [str(raw.text).strip() for raw in raw_segments]

    segments: list[TranscriptSegment] = []
    for raw, text in zip(raw_segments, translated):
        raw_start = float(raw.start)
        raw_end = float(raw.end)
        if is_translated_to_pt:
            words = _retime_translated_words(text, raw_start, raw_end)
        else:
            words = []
            for word in raw.words or []:
                word_text = str(word.word).strip()
                if not word_text:
                    continue
                words.append({
                    "start": float(word.start),
                    "end": float(word.end),
                    "text": word_text,
                })

        segments.append(TranscriptSegment(raw_start, raw_end, text, words))

    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(
        json.dumps([s.__dict__ for s in segments], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return segments
