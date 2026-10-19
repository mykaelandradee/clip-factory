from __future__ import annotations

import gc
import json
import os
import re
import subprocess
from pathlib import Path

os.environ.setdefault("OMP_NUM_THREADS", "4")
os.environ.setdefault("MKL_NUM_THREADS", "4")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "4")
os.environ.setdefault("NUMEXPR_NUM_THREADS", "4")

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
    """Make local NLLB output sound natural in casual Brazilian Portuguese.

    NLLB is multilingual and can occasionally choose European-Portuguese
    second-person conjugations. Short-form captions should use Brazilian
    conversational forms instead of literal/formal phrasing.
    """
    replacements = [
        # European Portuguese vocabulary/pronouns.
        (r"\bficheiro\b", "arquivo"),
        (r"\btelemóvel\b", "celular"),
        (r"\bautocarro\b", "ônibus"),
        (r"\bcomboio\b", "trem"),
        (r"\becrã\b", "tela"),
        (r"\bvós\b", "vocês"),
        (r"\bvosso\b", "de vocês"),
        (r"\bvossa\b", "de vocês"),
        (r"\bvossos\b", "de vocês"),
        (r"\bvossas\b", "de vocês"),
        (r"\btuas\b", "suas"),
        (r"\bteus\b", "seus"),
        (r"\btua\b", "sua"),
        (r"\bteu\b", "seu"),
        (r"\btu\b", "você"),
        # Second-person singular forms that sound European/formal in a BR caption.
        (r"\bés\b", "é"),
        (r"\bestás\b", "está"),
        (r"\bestavas\b", "estava"),
        (r"\bestarias\b", "estaria"),
        (r"\btens\b", "tem"),
        (r"\btinhas\b", "tinha"),
        (r"\bterias\b", "teria"),
        (r"\bvens\b", "vem"),
        (r"\bvinhas\b", "vinha"),
        (r"\bvirias\b", "viria"),
        (r"\bvais\b", "vai"),
        (r"\bias\b", "ia"),
        (r"\bqueres\b", "quer"),
        (r"\bquerias\b", "queria"),
        (r"\bpodes\b", "pode"),
        (r"\bpodias\b", "podia"),
        (r"\bfazes\b", "faz"),
        (r"\bfazias\b", "fazia"),
        (r"\bsabes\b", "sabe"),
        (r"\bsabias\b", "sabia"),
        (r"\bdizes\b", "diz"),
        (r"\bdizias\b", "dizia"),
        (r"\bpensas\b", "pensa"),
        (r"\bpensavas\b", "pensava"),
        (r"\bsentes\b", "sente"),
        (r"\bsentias\b", "sentia"),
        (r"\bachas\b", "acha"),
        (r"\bachavas\b", "achava"),
        (r"\bolhas\b", "olha"),
        (r"\bolhavas\b", "olhava"),
        (r"\busas\b", "usa"),
        (r"\busavas\b", "usava"),
        (r"\bprecisas\b", "precisa"),
        (r"\bprecisavas\b", "precisava"),
        (r"\bdeves\b", "deve"),
        (r"\bdeverias\b", "deveria"),
        (r"\btrazes\b", "traz"),
        (r"\btrazias\b", "trazia"),
        (r"\blevas\b", "leva"),
        (r"\blevavas\b", "levava"),
        (r"\bdeixas\b", "deixa"),
        (r"\bdeixavas\b", "deixava"),
        # Conversational Brazilian contractions for short-form captions.
        (r"\bestá\b", "tá"),
        (r"\bestão\b", "tão"),
        (r"\bestou\b", "tô"),
        # "para" só vira "pra" quando é certamente preposição (antes de pronome
        # ou lugar). Antes de artigo não dá para distinguir do verbo "parar"
        # ("ele para o carro"), então esses casos ficam como estão.
        (r"\bpara (?=(?:mim|você|vocês|ele|ela|eles|elas|a gente|casa|cá|lá)\b)", "pra "),
    ]

    out = text.strip()
    for pattern, replacement in replacements:
        out = re.sub(pattern, replacement, out, flags=re.IGNORECASE)

    # Avoid doubled spaces introduced by replacements and keep caption casing
    # controlled by the renderer.
    out = re.sub(r"\s{2,}", " ", out)
    return out.strip()


def _translate_unique(texts: list[str], generate, batch_size: int = 8) -> list[str]:
    """Traduz cada texto distinto uma única vez e devolve exatamente uma
    tradução por texto recebido, na mesma ordem.

    Corrige um bug antigo: frases repetidas já traduzidas ("yeah", "oh my god")
    faziam o lote devolver menos resultados, deslocando as traduções seguintes
    para os trechos errados e deixando os últimos sem tradução.
    """
    cache: dict[str, str] = {}
    unique = list(dict.fromkeys(texts))
    for start in range(0, len(unique), batch_size):
        batch = unique[start:start + batch_size]
        decoded = generate(batch)
        if len(decoded) != len(batch):
            raise RuntimeError(f"Local translation returned {len(decoded)} results for {len(batch)} captions.")
        for original, value in zip(batch, decoded):
            cache[original] = str(value).strip() or str(original).strip()
    return [cache[text] for text in texts]


SENTENCE_END = re.compile(r"[.!?…]['\")\]]*$")
CONTEXT_MAX_WORDS = 35
CONTEXT_MAX_GAP = 1.5


def _group_for_translation(segments: list[TranscriptSegment], indexes: list[int]) -> list[list[int]]:
    """Junta trechos consecutivos em frases completas, para o tradutor ver o
    contexto em vez de traduzir pedaços soltos. Um grupo termina no fim de uma
    frase, numa pausa longa ou ao atingir um tamanho máximo."""
    groups: list[list[int]] = []
    current: list[int] = []
    words = 0
    for index in indexes:
        segment = segments[index]
        if current:
            previous = segments[current[-1]]
            if index != current[-1] + 1 or float(segment.start) - float(previous.end) > CONTEXT_MAX_GAP:
                groups.append(current)
                current, words = [], 0
        current.append(index)
        words += len(segment.text.split())
        if SENTENCE_END.search(segment.text.strip()) or words >= CONTEXT_MAX_WORDS:
            groups.append(current)
            current, words = [], 0
    if current:
        groups.append(current)
    return groups


def _split_translation(text: str, weights: list[float]) -> list[str]:
    """Redistribui o texto traduzido de um grupo entre os trechos originais,
    proporcionalmente ao tamanho de cada um, sem perder nem repetir palavras.
    Com palavras suficientes, nenhum trecho fica vazio."""
    tokens = text.split()
    parts = len(weights)
    if parts <= 1:
        return [" ".join(tokens)]
    n = len(tokens)
    clean = [max(0.0, float(w)) for w in weights]
    total = sum(clean) or float(parts)
    if not sum(clean):
        clean = [1.0] * parts
    bounds = [0]
    cumulative = 0.0
    for i in range(1, parts):
        cumulative += clean[i - 1]
        cut = round(n * cumulative / total)
        if n >= parts:
            cut = max(cut, bounds[-1] + 1)        # pelo menos 1 palavra no trecho anterior
            cut = min(cut, n - (parts - i))       # e deixa ao menos 1 para cada trecho seguinte
        else:
            cut = min(max(cut, bounds[-1]), n)
        bounds.append(cut)
    bounds.append(n)
    return [" ".join(tokens[bounds[i]:bounds[i + 1]]) for i in range(parts)]


def _translate_to_pt(texts: list[str], source_language: str = "eng_Latn") -> list[str]:
    """Translate English captions to Brazilian Portuguese with a local model.

    The model is loaded once per job. If a batch fails because of a tokenizer/model
    edge case, retry that batch with the non-fast tokenizer instead of aborting the
    whole generation.
    """
    from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

    if not texts:
        return []

    # O modelo maior (1.3B) traduz de forma bem mais natural, mas usa vários GB
    # de memória: só é usado onde for configurado (GitHub Actions). O padrão
    # continua sendo o pequeno, seguro para máquinas com pouca memória.
    model_name = os.getenv("TRANSLATION_MODEL", "facebook/nllb-200-distilled-600M")
    tokenizer = AutoTokenizer.from_pretrained(model_name, use_fast=False, src_lang=source_language, tgt_lang="por_Latn")
    model = AutoModelForSeq2SeqLM.from_pretrained(model_name)
    model.eval()
    # Avoid Transformers generation warnings caused by stale model defaults.
    model.generation_config.max_length = None
    model.generation_config.early_stopping = False
    target_language_id = tokenizer.convert_tokens_to_ids("por_Latn")
    # This is inference-only. A single beam is enough for short social captions
    # and is substantially cheaper on GitHub Actions CPU than the model default.
    num_beams = max(1, min(8, int(os.getenv("TRANSLATION_BEAMS", "1") or 1)))

    import torch

    def generate(batch: list[str]) -> list[str]:
        try:
            inputs = tokenizer(batch, return_tensors="pt", padding=True, truncation=True, max_length=256)
            with torch.inference_mode():
                output_ids = model.generate(
                    **inputs,
                    max_new_tokens=160,
                    num_beams=num_beams,
                    forced_bos_token_id=target_language_id,
                )
            return tokenizer.batch_decode(output_ids, skip_special_tokens=True)
        except Exception as batch_error:
            print(f"[translation] batch failed, retrying individually: {batch_error}")
            decoded = []
            for item in batch:
                retry_inputs = tokenizer([item], return_tensors="pt", padding=True, truncation=True, max_length=256)
                with torch.inference_mode():
                    retry_ids = model.generate(
                        **retry_inputs,
                        max_new_tokens=160,
                        num_beams=num_beams,
                        forced_bos_token_id=target_language_id,
                    )
                decoded.extend(tokenizer.batch_decode(retry_ids, skip_special_tokens=True))
            return decoded

    try:
        translated = _translate_unique(texts, generate)
    finally:
        del model
        del tokenizer
        gc.collect()

    return translated


# Códigos do Whisper -> códigos do NLLB para o idioma de origem da tradução.
NLLB_LANGUAGE_CODES = {
    "en": "eng_Latn", "es": "spa_Latn", "fr": "fra_Latn", "de": "deu_Latn",
    "it": "ita_Latn", "nl": "nld_Latn", "ru": "rus_Cyrl", "uk": "ukr_Cyrl",
    "pl": "pol_Latn", "tr": "tur_Latn", "ja": "jpn_Jpan", "zh": "zho_Hans",
    "ko": "kor_Hang", "ar": "arb_Arab", "hi": "hin_Deva", "id": "ind_Latn",
}


def translate_segments_to_pt(segments: list[TranscriptSegment], candidates, source_language: str = "en") -> None:
    """Translate only segments that will actually appear in rendered clips."""
    if not segments or not candidates:
        return

    indexes = []
    for index, segment in enumerate(segments):
        if any(segment.end > candidate.start and segment.start < candidate.end for candidate in candidates):
            indexes.append(index)

    if not indexes:
        return

    source_texts = [segments[index].text for index in indexes]
    if source_language in {"pt", "pt-br", "por_Latn"}:
        translated = [_normalize_pt_br(text) for text in source_texts]
    else:
        source_code = NLLB_LANGUAGE_CODES.get(source_language.lower(), "eng_Latn")
        # Traduz frases completas (com contexto) e redistribui nos tempos originais.
        groups = _group_for_translation(segments, indexes)
        group_texts = [" ".join(segments[i].text.strip() for i in group) for group in groups]
        group_translations = _translate_to_pt(group_texts, source_code)
        by_index: dict[int, str] = {}
        for group, translation in zip(groups, group_translations):
            weights = [max(1, len(segments[i].text.split())) for i in group]
            for i, piece in zip(group, _split_translation(_normalize_pt_br(translation), weights)):
                by_index[i] = piece
        translated = [by_index.get(i, "") or _normalize_pt_br(segments[i].text) for i in indexes]
    for index, text in zip(indexes, translated):
        segment = segments[index]
        segment.text = text
        segment.words = _retime_translated_words(
            text,
            segment.start,
            segment.end,
            segment.words,
        )


def _retime_translated_words(text: str, start: float, end: float, source_words: list[dict] | None = None) -> list[dict]:
    tokens = text.split()
    if not tokens:
        return []

    spoken = [
        word for word in (source_words or [])
        if str(word.get("text", word.get("word", ""))).strip()
        and float(word.get("end", end)) > start
        and float(word.get("start", start)) < end
    ]
    if spoken:
        spans = [
            (
                max(start, float(word.get("start", start))),
                min(end, float(word.get("end", end))),
            )
            for word in spoken
        ]
        mapped = []
        for index, token in enumerate(tokens):
            source_index = min(len(spans) - 1, int(index * len(spans) / len(tokens)))
            bucket_start = int(source_index * len(tokens) / len(spans))
            bucket_end = max(bucket_start + 1, int((source_index + 1) * len(tokens) / len(spans)))
            span_start, span_end = spans[source_index]
            slot = index - bucket_start
            count = max(1, bucket_end - bucket_start)
            step = max(0.01, (span_end - span_start) / count)
            mapped.append({
                "start": span_start + slot * step,
                "end": span_start + (slot + 1) * step,
                "text": token,
            })
        return mapped

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


def _keep_segment(raw: dict) -> bool:
    """Descarta só o que é claramente ruído ou alucinação do Whisper.

    O filtro antigo (no_speech > 0,55 OU confiança < -1,2) apagava fala real em
    vídeos com música ou efeitos de fundo. Agora um trecho só sai se for texto
    repetitivo (alucinação típica) ou se o Whisper estiver confiante de que não
    há fala E o texto tiver confiança muito baixa ao mesmo tempo.
    """
    if not str(raw.get("text", "")).strip():
        return False
    if float(raw.get("compression_ratio", 0.0)) >= 2.6:
        return False
    no_speech = float(raw.get("no_speech_prob", 0.0))
    avg_logprob = float(raw.get("avg_logprob", 0.0))
    return not (no_speech >= 0.8 and avg_logprob <= -1.0)


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

    # GitHub-hosted runners have multiple CPU cores. The previous hard limit of
    # one BLAS/OpenMP thread made Whisper small dramatically slower than necessary.
    # Match the runner's practical CPU budget and use greedy decoding for speed.
    try:
        import torch
        torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
        torch.set_num_interop_threads(1)
    except Exception:
        pass

    model = whisper.load_model(model_name, device="cpu")
    speech_audio: Path | None = None
    try:
        # PT-BR must first transcribe the original language. For English output,
        # Whisper can use its native translation task.
        task = "translate" if subtitle_language == "en" else "transcribe"

        def _run(path: Path, language: str | None = None):
            kwargs = {
                "verbose": False,
                "fp16": False,
                "temperature": 0.0,
                "beam_size": 1,
                "condition_on_previous_text": False,
                "word_timestamps": True,
                # Valor mais alto: com 1,0 s, trechos curtos de fala após pausas
                # (comuns com música/efeitos de fundo) eram pulados.
                "hallucination_silence_threshold": 2.0,
                "task": task,
            }
            if language:
                kwargs["language"] = language
            return model.transcribe(str(path), **kwargs)

        # Keep the 16 kHz mono speech track as the primary input. It was the
        # faster and more stable path for interview audio; using the full MP4
        # soundtrack here caused a major CPU regression on GitHub Actions.
        speech_audio = _speech_only_audio(video_path)
        # PT-BR translation is English -> Portuguese. Pin Whisper to English
        # in this mode so short interview audio is not misclassified as Welsh,
        # Spanish, etc., which can produce nonsensical translated captions.
        source_language = None
        result = _run(speech_audio, language=source_language)

        raw_segments = [raw for raw in result.get("segments", []) if _keep_segment(raw)]
        dropped = [raw for raw in result.get("segments", []) if raw.get("text", "").strip() and not _keep_segment(raw)]
        if dropped:
            print(f"[transcription] {len(dropped)} trecho(s) descartado(s) como ruído/alucinação: "
                  + "; ".join(f"{float(r['start']):.1f}-{float(r['end']):.1f}s" for r in dropped[:10]))
        all_raw_segments = [
            raw for raw in result.get("segments", [])
            if raw.get("text", "").strip()
        ]

        # Avoid letting the confidence filter erase valid parts of a clean
        # interview. If it removes a substantial portion of the transcript,
        # retain Whisper's non-empty segments and let clip selection score them.
        filtered_span = (
            max((float(raw["end"]) for raw in raw_segments), default=0.0)
            - min((float(raw["start"]) for raw in raw_segments), default=0.0)
        )
        all_span = (
            max((float(raw["end"]) for raw in all_raw_segments), default=0.0)
            - min((float(raw["start"]) for raw in all_raw_segments), default=0.0)
        )
        if (
            not raw_segments
            or (
                len(all_raw_segments) >= 3
                and len(raw_segments) < max(2, int(len(all_raw_segments) * 0.60))
            )
            or (all_span >= 30.0 and filtered_span < all_span * 0.60)
        ):
            print(
                "[transcription] confidence filter removed too much speech; "
                f"using all non-empty Whisper segments "
                f"(filtered={len(raw_segments)}, all={len(all_raw_segments)})"
            )
            raw_segments = all_raw_segments

        # If the original soundtrack produced no text at all, retry on the
        # speech-focused track before failing the job.
        if not raw_segments:
            result = _run(video_path, language=source_language)
            raw_segments = [
                raw for raw in result.get("segments", [])
                if raw.get("text", "").strip()
            ]

        detected_language = str(result.get("language", "")).lower()
        print(f"[transcription] detected_language={detected_language or 'unknown'}")
    finally:
        del model
        gc.collect()
        if speech_audio and speech_audio.exists():
            try:
                speech_audio.unlink()
            except OSError:
                pass

    segments: list[TranscriptSegment] = []
    for raw in raw_segments:
        text = str(raw["text"]).strip()
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

        # O idioma detectado precisa ir em cada trecho: é por ele que a tradução
        # escolhe o idioma de origem. Antes ficava vazio e tudo era tratado
        # como inglês, inclusive vídeos em espanhol ou já em português.
        segments.append(
            TranscriptSegment(
                float(raw["start"]), float(raw["end"]), text, words, detected_language
            )
        )

    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(
        json.dumps([s.__dict__ for s in segments], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return segments
