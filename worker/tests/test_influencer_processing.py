"""Regras do processamento de vídeos do Influencer Manager."""
import pytest

from clip_factory import influencer_processing as ip


def test_normalize_mode():
    assert ip.normalize_mode(None) == "original"
    assert ip.normalize_mode(" Clips ") == "clips"
    with pytest.raises(ValueError):
        ip.normalize_mode("shell; rm -rf /")


def test_caption_style_falls_back_to_default():
    assert ip.normalize_caption_style("fire") == "fire"
    assert ip.normalize_caption_style("unknown") == ip.DEFAULT_CAPTION_STYLE
    assert ip.normalize_caption_style(None) == ip.DEFAULT_CAPTION_STYLE


@pytest.mark.parametrize("raw,expected", [(0, 1), (3, 3), (10, 10), (99, 10), ("7", 7), ("x", 5), (None, 5)])
def test_clip_count_is_clamped(raw, expected):
    assert ip.normalize_clip_count(raw) == expected


def test_duration_rules():
    ip.validate_duration("original", 3600)
    ip.validate_duration("captioned", 180)
    ip.validate_duration("clips", 3600)
    with pytest.raises(ValueError, match="Cortes"):
        ip.validate_duration("captioned", 181)
    with pytest.raises(ValueError, match="curto demais"):
        ip.validate_duration("clips", 12)


def test_keys_keep_legacy_path_for_single_video():
    prefix = ip.item_prefix("u", "lib", "item")
    assert ip.output_key(prefix, "original", 1) == "influencer/u/libraries/lib/item/video.mp4"
    assert ip.output_key(prefix, "captioned", 1).endswith("/video.mp4")
    assert ip.output_key(prefix, "clips", 3).endswith("/clip-03.mp4")
    assert ip.manifest_key(prefix).endswith("/manifest.json")


def test_manifest_serialization():
    manifest = ip.Manifest(
        version=1, item_id="item", mode="clips", caption_style="fire",
        source_title="Podcast", source_description="", source_duration=600.0,
        transcript=ip.trim_transcript("  olá   mundo  "),
        outputs=[ip.OutputVideo(index=1, key="k1", start=10.0, end=42.5, transcript="a")],
    )
    data = manifest.to_dict()
    assert data["transcript"] == "olá mundo"
    assert data["outputs"][0]["duration"] == 32.5
    assert data["outputs"][0]["key"] == "k1"
