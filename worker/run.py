from __future__ import annotations

import argparse
import json
from urllib.parse import urlparse

from clip_factory.pipeline import run_pipeline


CAPTION_STYLES = ["karaoke", "fire", "beasty", "youshaei", "harmozi", "cinematic"]


def main() -> None:
    parser = argparse.ArgumentParser(description="Clip Factory worker")
    parser.add_argument("url", help="YouTube URL")
    parser.add_argument("--provider", choices=["local", "heuristic"], default="local")
    parser.add_argument("--count", type=int, default=5)
    parser.add_argument("--min-duration", type=int, default=20)
    parser.add_argument("--max-duration", type=int, default=60)
    parser.add_argument("--subtitle-language", choices=["original", "pt-BR", "en"], default="original")
    parser.add_argument("--caption-style", choices=CAPTION_STYLES, default="karaoke")
    parser.add_argument("--no-render", action="store_true")
    args = parser.parse_args()

    parsed_url = urlparse(args.url)
    if parsed_url.scheme != "https" or parsed_url.hostname not in {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}:
        parser.error("A URL precisa ser um endereço HTTPS válido do YouTube.")
    if not 1 <= args.count <= 15:
        parser.error("--count deve estar entre 1 e 15.")
    if not 5 <= args.min_duration <= 300:
        parser.error("--min-duration deve estar entre 5 e 300 segundos.")
    if not 5 <= args.max_duration <= 300:
        parser.error("--max-duration deve estar entre 5 e 300 segundos.")
    if args.max_duration < args.min_duration:
        parser.error("--max-duration não pode ser menor que --min-duration.")

    result = run_pipeline(
        args.url,
        args.provider,
        args.count,
        args.min_duration,
        args.max_duration,
        not args.no_render,
        subtitle_language=args.subtitle_language,
        caption_style=args.caption_style,
    )
    print(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
