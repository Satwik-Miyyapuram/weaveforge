"""The sync-source contracts and their shared value objects."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable

from ..features.experiments.domain.metric_point import MetricSeries


class SyncError(Exception):
    """A sync source failed to read its input."""


class MissingDependencyError(SyncError):
    """A source's optional dependency isn't installed.

    Raised with an actionable ``pip install weaveforge[extra]`` hint so the
    decorator can degrade gracefully instead of crashing a training run.
    """

    def __init__(self, source_id: str, extra: str, package: str) -> None:
        super().__init__(
            f"The '{source_id}' sync source needs the '{package}' package. "
            f"Install it with: pip install 'weaveforge[{extra}]'"
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


@runtime_checkable
class Mirror(Protocol):
    """A live second home for a run's numbers, written to as they arrive.

    The counterpart of :class:`MetricSource`: a source imports a run somebody
    else already finished, a mirror carries this one along while it happens.
    Every method has to be survivable — a mirror that cannot reach its service
    must not take the training run down with it.
    """

    def log(self, metrics: Mapping[str, float], step: int | None) -> None: ...

    def finish(self, status: str) -> None:
        """The run is over. Called once, whatever the outcome."""
        ...


@runtime_checkable
class MirrorSource(Protocol):
    id: str

    def available(self) -> bool: ...

    def open(self, *, name: str, config: Mapping[str, Any]) -> Mirror:
        """Start a mirrored run alongside this one."""
        ...
