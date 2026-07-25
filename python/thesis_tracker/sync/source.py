"""The sync-source contracts and their shared value objects."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable

from ..features.experiments.domain.metric_point import MetricSeries


class SyncError(Exception):
    """A sync source failed to read its input."""


class MissingDependencyError(SyncError):
    """A source's optional dependency isn't installed.

    Raised with an actionable ``pip install thesis-tracker[extra]`` hint so the
    decorator can degrade gracefully instead of crashing a training run.
    """

    def __init__(self, source_id: str, extra: str, package: str) -> None:
        super().__init__(
            f"The '{source_id}' sync source needs the '{package}' package. "
            f"Install it with: pip install 'thesis-tracker[{extra}]'"
        )
        self.source_id = source_id
        self.extra = extra
        self.package = package


@dataclass
class Artifact:
    """A file to upload (``data``) or an already-hosted link (``url``)."""

    name: str
    data: bytes | None = None
    content_type: str = "application/octet-stream"
    url: str | None = None


@runtime_checkable
class MetricSource(Protocol):
    #: Stable identifier used to select the source, e.g. ``"tensorboard"``.
    id: str

    def available(self) -> bool:
        """Whether this source's optional dependency is importable."""
        ...

    def read(self, ref: Any) -> Iterable[MetricSeries]:
        """Read curves from ``ref`` (a logdir, run path, … — source-specific)."""
        ...


@runtime_checkable
class ArtifactSource(Protocol):
    id: str

    def available(self) -> bool: ...

    def collect(self, ref: Any) -> Iterable[Artifact]:
        """Produce artifacts (figure bytes, run links, …) from ``ref``."""
        ...
