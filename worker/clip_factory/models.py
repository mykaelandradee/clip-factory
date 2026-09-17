from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal

AIProvider = Literal["openai", "anthropic", "ollama"]


@dataclass
class TranscriptSegment:
    start: float
    end: float
    text: str


@dataclass
class ClipCandidate:
    start: float
    end: float
    title: str
    hook: str
    reason: str
    score: float
    transcript: str = ""

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ProjectResult:
    project_id: str
    source_url: str
    source_file: str
    transcript_file: str
    candidates: list[ClipCandidate] = field(default_factory=list)
    rendered_files: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "project_id": self.project_id,
            "source_url": self.source_url,
            "source_file": self.source_file,
            "transcript_file": self.transcript_file,
            "candidates": [c.to_dict() for c in self.candidates],
            "rendered_files": self.rendered_files,
        }
