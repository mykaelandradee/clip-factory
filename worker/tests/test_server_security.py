"""Testes das proteções de segurança do servidor HTTP do worker."""
import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

from conftest import DATA_DIR
from clip_factory import server
from clip_factory.config import settings

TOKEN = "test-token"


@pytest.fixture(scope="module")
def base_url():
    (DATA_DIR / "projects" / "p1").mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "projects" / "p1" / "clip-01.mp4").write_bytes(b"video")
    (DATA_DIR / "projects" / "p1" / "notes.json").write_text("{}")
    (DATA_DIR / "youtube_cookies.txt").write_text("SECRET-COOKIE")
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()


def request(base_url, path, *, token=TOKEN, method="GET", body=None):
    headers = {"Content-Type": "application/json"}
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base_url + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def test_health_is_public(base_url):
    assert request(base_url, "/health", token=None)[0] == 200


def test_requires_valid_token(base_url):
    assert request(base_url, "/files/projects/p1/clip-01.mp4", token=None)[0] == 401
    assert request(base_url, "/files/projects/p1/clip-01.mp4", token="wrong")[0] == 401


def test_serves_rendered_media(base_url):
    status, body = request(base_url, "/files/projects/p1/clip-01.mp4")
    assert status == 200 and body == b"video"


@pytest.mark.parametrize("path", [
    "/files/youtube_cookies.txt",
    "/files/projects/%2e%2e/youtube_cookies.txt",
    "/files/projects/p1/notes.json",
    "/files/projects/../youtube_cookies.txt",
])
def test_never_serves_secrets_or_non_media(base_url, path):
    status, body = request(base_url, path)
    assert status in (400, 404)
    assert b"SECRET-COOKIE" not in body


@pytest.mark.parametrize("url", [
    "file:///etc/passwd",
    "http://169.254.169.254/latest/meta-data/",
    "http://youtube.com/watch?v=x",
    "https://evil.example/watch?v=x",
])
def test_jobs_only_accepts_https_youtube_urls(base_url, url):
    status, body = request(base_url, "/jobs", method="POST", body={"url": url})
    assert status == 400
    assert "YouTube" in json.loads(body)["error"]


def test_is_youtube_url():
    assert server.is_youtube_url("https://www.youtube.com/watch?v=abc")
    assert server.is_youtube_url("https://youtu.be/abc")
    assert not server.is_youtube_url("https://youtube.com.evil.example/x")
    assert not server.is_youtube_url("javascript:alert(1)")


def test_refuses_to_start_off_localhost_without_token(monkeypatch):
    monkeypatch.setattr(server, "settings", settings.__class__(worker_host="0.0.0.0", worker_token=None))
    with pytest.raises(SystemExit):
        server.main()
