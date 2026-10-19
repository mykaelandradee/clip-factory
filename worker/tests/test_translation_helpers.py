"""Tradução das legendas: alinhamento, contexto e redistribuição nos tempos."""
import pytest

from clip_factory.models import TranscriptSegment
from clip_factory.transcription import (
    _group_for_translation, _keep_segment, _normalize_pt_br, _split_translation, _translate_unique,
)


def seg(start, end, text):
    return TranscriptSegment(start, end, text, [], "en")


def test_repeated_phrases_keep_translations_aligned():
    # Bug antigo: "yeah" repetido encurtava o lote e deslocava as traduções.
    calls = []

    def fake_generate(batch):
        calls.append(list(batch))
        return [f"PT({t})" for t in batch]

    texts = ["yeah", "go go", "yeah", "watch out", "yeah"] + [f"line {i}" for i in range(10)] + ["yeah"]
    out = _translate_unique(texts, fake_generate, batch_size=8)
    assert out == [f"PT({t})" for t in texts]
    assert sum(len(c) for c in calls) == len(set(texts))  # cada frase traduzida uma vez


def test_groups_follow_sentences_and_pauses():
    segments = [
        seg(0, 2, "So I was driving"),
        seg(2, 4, "down the highway."),
        seg(4.2, 6, "Then the cops"),
        seg(10, 12, "showed up"),          # pausa longa: novo grupo
        seg(12, 14, "out of nowhere!"),
    ]
    assert _group_for_translation(segments, [0, 1, 2, 3, 4]) == [[0, 1], [2], [3, 4]]
    # Índices não consecutivos nunca são juntados.
    assert _group_for_translation(segments, [0, 2]) == [[0], [2]]


def test_long_runs_are_split():
    segments = [seg(i, i + 1, "word " * 10) for i in range(6)]  # sem pontuação
    groups = _group_for_translation(segments, list(range(6)))
    assert all(sum(len(segments[i].text.split()) for i in g) <= 40 for g in groups)
    assert [i for g in groups for i in g] == list(range(6))


@pytest.mark.parametrize("text,weights", [
    ("eu tava dirigindo pela estrada", [4, 3]),
    ("a b c d e f g h i j", [1, 1, 1]),
    ("uma", [2, 2, 2]),
    ("", [1, 2]),
    ("x y", [0, 0]),
])
def test_split_keeps_every_word_in_order(text, weights):
    parts = _split_translation(text, weights)
    assert len(parts) == len(weights)
    assert " ".join(p for p in parts if p).split() == text.split()
    if len(text.split()) >= len(weights):
        assert all(parts)


def test_split_is_proportional():
    assert _split_translation("a b c d e f g h", [6, 2]) == ["a b c d e f", "g h"]


def test_keep_segment_only_drops_clear_noise():
    speech_over_music = {"text": "watch out", "no_speech_prob": 0.6, "avg_logprob": -1.3, "compression_ratio": 1.4}
    assert _keep_segment(speech_over_music)                     # antes era descartado
    assert not _keep_segment({"text": "la la la la la la", "no_speech_prob": 0.1, "avg_logprob": -0.2, "compression_ratio": 3.0})
    assert not _keep_segment({"text": "Thanks for watching", "no_speech_prob": 0.9, "avg_logprob": -1.4, "compression_ratio": 1.1})
    assert not _keep_segment({"text": "   "})


def test_para_only_contracts_when_unambiguous():
    assert _normalize_pt_br("vou para casa") == "vou pra casa"
    assert _normalize_pt_br("isso é para você") == "isso é pra você"
    assert _normalize_pt_br("ele para o carro") == "ele para o carro"   # verbo "parar"
    assert _normalize_pt_br("não para nunca") == "não para nunca"
    assert _normalize_pt_br("nós estamos aqui") == "nós estamos aqui"   # sem "tamo"


def test_translate_segments_uses_sentence_context(monkeypatch):
    from clip_factory import transcription
    from clip_factory.models import ClipCandidate

    received = []

    def fake_translate(texts, source_code):
        received.extend(texts)
        table = {
            "So I was driving down the highway.": "Então eu tava dirigindo pela estrada.",
            "Then the cops showed up!": "Aí a polícia apareceu!",
        }
        return [table[t] for t in texts]

    monkeypatch.setattr(transcription, "_translate_to_pt", fake_translate)
    segments = [
        TranscriptSegment(0.0, 2.0, "So I was driving", [{"text": "So", "start": 0.0, "end": 0.4}], "en"),
        TranscriptSegment(2.0, 4.0, "down the highway.", [], "en"),
        TranscriptSegment(4.2, 6.0, "Then the cops showed up!", [], "en"),
    ]
    transcription.translate_segments_to_pt(segments, [ClipCandidate(0.0, 6.0, "", "", "", 1.0, "")], "en")

    # O tradutor recebeu frases completas, não pedaços soltos.
    assert received == ["So I was driving down the highway.", "Then the cops showed up!"]
    assert " ".join(s.text for s in segments[:2]) == "Então eu tava dirigindo pela estrada."
    assert segments[2].text == "Aí a polícia apareceu!"
    # Cada trecho tem palavras dentro do próprio intervalo de tempo.
    for s in segments:
        assert s.words and all(s.start - 0.01 <= w["start"] <= w["end"] <= s.end + 0.01 for w in s.words)


def test_source_language_is_respected(monkeypatch):
    from clip_factory import transcription
    from clip_factory.models import ClipCandidate

    codes = []
    monkeypatch.setattr(transcription, "_translate_to_pt", lambda texts, code: codes.append(code) or ["traduzido"] * len(texts))
    candidate = [ClipCandidate(0.0, 5.0, "", "", "", 1.0, "")]

    transcription.translate_segments_to_pt([TranscriptSegment(0, 2, "Hola amigos.", [], "es")], candidate, "es")
    transcription.translate_segments_to_pt([TranscriptSegment(0, 2, "Hello there.", [], "en")], candidate, "en")
    assert codes == ["spa_Latn", "eng_Latn"]

    # Áudio já em português: não passa pelo tradutor.
    pt = [TranscriptSegment(0, 2, "vou para casa", [], "pt")]
    transcription.translate_segments_to_pt(pt, candidate, "pt")
    assert codes == ["spa_Latn", "eng_Latn"] and pt[0].text == "vou pra casa"
