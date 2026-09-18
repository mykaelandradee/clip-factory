from __future__ import annotations

import argparse
import json

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
