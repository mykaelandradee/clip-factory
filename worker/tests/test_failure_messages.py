"""Mensagens de falha do processamento: o usuário precisa saber o que fazer."""
from clip_factory import influencer_processing as ip

YT = "https://www.youtube.com/watch?v=abc"
IG = "https://www.instagram.com/reel/xyz/"


def test_expired_youtube_cookies():
    raw = "ERROR: [youtube] abc: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies"
    result = ip.classify_failure(raw, YT)
    assert result["kind"] == "cookies"
    assert "cookies" in result["message"]


def test_instagram_login_is_not_blamed_on_youtube_cookies():
    result = ip.classify_failure("ERROR: [Instagram] xyz: Requested content is not available, rate-limit reached or login required", IG)
    assert result["kind"] == "instagram_login"


def test_unavailable_video():
    assert ip.classify_failure("ERROR: [youtube] abc: Private video. Sign in if you've been granted access", YT)["kind"] in {"unavailable", "cookies"}
    assert ip.classify_failure("ERROR: [youtube] abc: Video unavailable. This video has been removed", YT)["kind"] == "unavailable"


def test_worker_validation_messages_are_kept():
    msg = "O modo Legendado aceita vídeos de até 3 minutos. Para vídeos mais longos, use o modo Cortes."
    assert ip.classify_failure(msg, YT) == {"kind": "invalid", "message": msg}


def test_unknown_errors_are_truncated():
    result = ip.classify_failure("x" * 2000, YT)
    assert result["kind"] == "unknown" and len(result["message"]) <= 500
    assert ip.classify_failure("", YT)["message"] == "O processamento falhou."


def test_error_key():
    assert ip.error_key("influencer/u/libraries/l/i") == "influencer/u/libraries/l/i/error.json"
