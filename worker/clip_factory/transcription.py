from __future__ import annotations

import gc
import json
import os
import re
import subprocess
from pathlib import Path

os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("NUMEXPR_NUM_THREADS", "1")

from .models import TranscriptSegment


def _speech_only_audio(video_path: Path) -> Path:
    """Create a mono speech-focused track by suppressing low-frequency music bed.
    This is intentionally conservative: it reduces music contamination without
    requiring a paid API or a large extra ML model."""
    output = video_path.with_name(video_path.stem + ".speech.wav")
    cmd = [
        "ffmpeg", "-y", "-i", str(video_path),
        "-vn", "-ac", "1", "-ar", "16000",
        "-af", "highpass=f=120,lowpass=f=5000,dynaudnorm=f=150:g=7",
        str(output),
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return output


def _normalize_pt_br(text: str) -> str:
    # Keep the local translation model, but normalize a few common European
    # Portuguese forms that are undesirable in Brazilian short-form captions.
    replacements = {
        r"\\bficheiro\\b": "arquivo",
        r"\\btelemóvel\\b": "celular",
        r"\\bautocarro\\b": "ônibus",
        r"\\bcomboio\\b": "trem",
        r"\\becrã\\b": "tela",
        r"\\btu\\b": "você",
        r"\\btuas\\b": "suas",
        r"\\bteu\\b": "seu",
        r"\\btua\\b": "sua",
    }
    out = text.strip()
    for pattern, replacement in replacements.items():
        out = re.sub(pattern, replacement, out, flags=re.IGNORECASE)
    return out


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
    import whisper

    if subtitle_language not in {"original", "pt-BR", "en"}:
        raise ValueError("Idioma de legenda não suportado.")

    # First pass on a speech-focused track. The original video remains the
    # source for final timestamps; this pass is only used to reduce music bleed.
    speech_audio = _speech_only_audio(video_path)
    model = whisper.load_model(model_name, device="cpu")
    try:
        task = "translate" if subtitle_language == "en" else "transcribe"

        def _run(path: Path):
            return model.transcribe(
                str(path),
                verbose=False,
                fp16=False,
                temperature=(0.0, 0.2, 0.4, 0.6),
                beam_size=5,
                condition_on_previous_text=False,
                word_timestamps=True,
                hallucination_silence_threshold=1.0,
                task=task,
            )

        result = _run(speech_audio)

        def _keep(raw):
            return (
                raw.get("text", "").strip()
                and float(raw.get("no_speech_prob", 0.0)) < 0.55
                and float(raw.get("avg_logprob", -10.0)) > -1.2
                and float(raw.get("compression_ratio", 0.0)) < 2.8
            )

        raw_segments = [raw for raw in result.get("segments", []) if _keep(raw)]

        # Music-only videos are intentionally supported: when the speech-focused
        # pass finds no credible speech, fall back to the original soundtrack so
        # lyrics can still be captioned.
        if not raw_segments:
            result = _run(video_path)
            raw_segments = [raw for raw in result.get("segments", []) if raw.get("text", "").strip()]
    finally:
        del model
        gc.collect()
    detected_language = str(result.get("language", "")).lower()
    is_translated_to_pt = subtitle_language == "pt-BR" and detected_language not in {"pt", "pt-br"}

    if is_translated_to_pt:
        translated = [
            _normalize_pt_br(text)
            for text in _translate_to_pt([str(raw["text"]).strip() for raw in raw_segments])
        ]
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
