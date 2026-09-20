"""What the tracking entry points need from a container.

``track()`` needs one thing from whatever container it is handed: somewhere to
create the experiment. Two more are optional and belong to the connection rather
than the experiment — a place to put bytes, and a handle to close when ``track``
opened the connection itself.

Naming the first of them is what lets ``py.typed`` mean something at the SDK's
front door. The container used to be typed ``Any`` and its capabilities
discovered with ``getattr(getattr(container, "artifacts", None), "upload",
None)``: misspell ``artifacts`` in a refactor and uploads silently disappear,
because the chain answers ``None`` and the ``Run`` simply has no uploader. The
two optional capabilities are reached through :func:`artifact_uploader` and
:func:`api_closer`, which name the port they return instead of ``Any`` — a
container is still allowed to lack them (``MemoryContainer`` did until now), but
what comes back is typed as the port, not as "whatever was there".

These live in ``shared`` rather than beside ``track`` because ``Container``
(``container.py``) and ``MemoryContainer`` (``testing/``) both have to satisfy
them, and neither should have to import the front door to say so.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from typing import Any, Protocol, cast, runtime_checkable

from ..features.experiments.domain.experiment import (
    Experiment,
    ExperimentStatus,
    NewExperimentInput,
)
from ..features.experiments.domain.metric_point import MetricPoint

#: How an uploader is called once it has been found on a container. Spelled out
#: rather than left to ``Any`` because ``Run`` stores exactly this.
ArtifactUpload = Callable[[str, str, bytes, str], str]


@runtime_checkable
class ExperimentWriter(Protocol):
    """Creates the experiment row a run is about."""

    def add(self, data: NewExperimentInput) -> Experiment: ...


@runtime_checkable
class ExperimentBookkeeper(Protocol):
    """Everything :class:`Run` asks of the application service behind it.

    Narrower than ``ManageExperimentUseCase`` on purpose: a ``Run`` needs to
    record metrics, attach links, set a status and write history. It does not
    need that service's repository, clock or id generator, and saying so lets an
    in-memory double satisfy it without pretending to be the whole service.
    """

    def add(self, data: NewExperimentInput) -> Experiment: ...

    def set_status(
        self, id: str, status: ExperimentStatus, *, existing: Experiment | None = None
    ) -> Experiment: ...

    def record_metrics(
        self, id: str, metrics: dict[str, Any], *, existing: Experiment | None = None
    ) -> Experiment: ...

    def add_artifacts(
        self, id: str, links: Iterable[str], *, existing: Experiment | None = None
    ) -> Experiment: ...

    def record_history(
        self, points: Iterable[MetricPoint], *, timeout: float | None = None
    ) -> None: ...


@runtime_checkable
class ArtifactUploader(Protocol):
    """Stores bytes and returns somewhere they can be read back from."""

    def upload(
        self,
        experiment_id: str,
        name: str,
        data: bytes,
        content_type: str = ...,
    ) -> str: ...


@runtime_checkable
class Closer(Protocol):
    """Releases the connection a client is holding."""

    def close(self) -> None: ...


@runtime_checkable
class TrackingContainer(Protocol):
    """The one capability every container must have to be usable by ``track``."""

    manage_experiment: ExperimentBookkeeper


def artifact_uploader(container: object) -> ArtifactUpload | None:
    """The container's artifact uploader, or ``None`` if it has none.

    One level instead of two, and the answer is typed. A container built without
    blob storage is a legitimate thing to pass — the ``Run`` then refuses
    ``log_bytes`` with a message saying so rather than failing somewhere later.
    """
    artifacts = getattr(container, "artifacts", None)
    upload = getattr(artifacts, "upload", None)
    if not callable(upload):
        return None
    # A bound method whose shape the protocol above spells out. This cast is the
    # one place the lookup stops being checked, which is why it lives here rather
    # than being repeated at the call site.
    return cast(ArtifactUpload, upload)


def api_closer(container: object) -> Closer | None:
    """The handle that closes the container's HTTP pool, or ``None``.

    Note where the close lives: on ``container.api``, not on the container
    itself (``Container`` has no ``close``). An in-memory container may have
    neither, which is why this is optional rather than a protocol member.
    """
    api = getattr(container, "api", None)
    close = getattr(api, "close", None)
    return api if callable(close) else None
