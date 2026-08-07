"""A tiny registry so sources are discovered by id instead of hard-wired.

Adding a source = construct it and ``register()`` it (sources do this on import).
Selecting one = ``get(id)``. This is the whole extensibility mechanism: the
``Run`` asks the registry for ``sync=["tensorboard"]`` and never names a class.
"""

from __future__ import annotations

from .source import ArtifactSource, MetricSource

AnySource = MetricSource | ArtifactSource


class SyncRegistry:
    def __init__(self) -> None:
        self._sources: dict[str, AnySource] = {}

    def register(self, source: AnySource, *, replace: bool = False) -> AnySource:
        if source.id in self._sources and not replace:
            raise ValueError(f"A sync source with id '{source.id}' is already registered.")
        self._sources[source.id] = source
        return source

    def get(self, source_id: str) -> AnySource:
        try:
            return self._sources[source_id]
        except KeyError:
            known = ", ".join(sorted(self._sources)) or "<none>"
            raise KeyError(
                f"Unknown sync source '{source_id}'. Registered: {known}."
            ) from None

    def has(self, source_id: str) -> bool:
        return source_id in self._sources

    def ids(self) -> list[str]:
        return sorted(self._sources)


#: Process-wide default registry that built-in sources register themselves with.
default_registry = SyncRegistry()
