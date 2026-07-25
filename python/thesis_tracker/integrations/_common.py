"""Shared plumbing for the framework callbacks: scalar extraction and a small
manual context-manager wrapper around :func:`track`."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any


def to_scalars(logs: Mapping[str, Any] | None) -> dict[str, float]:
    """Coerce a framework's metrics dict (tensors / numpy / floats) into plain
    ``{name: float}``, skipping non-numeric and non-scalar values."""
    out: dict[str, float] = {}
    for key, value in dict(logs or {}).items():
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float)):
            out[key] = float(value)
            continue
        item = getattr(value, "item", None)  # torch/numpy scalar
        if callable(item):
            try:
                scalar = item()
            except Exception:
                continue
            if isinstance(scalar, (int, float)) and not isinstance(scalar, bool):
                out[key] = float(scalar)
    return out


class RunSession:
    """Owns a :func:`track` context manager entered/exited by callback hooks
    (which don't map onto a ``with`` block)."""

    def __init__(self, name: str, **track_kwargs: Any) -> None:
        self._name = name
        self._kwargs = track_kwargs
        self._cm: Any = None
        self.run: Any = None

    def start(self) -> Any:
        from ..tracking import track

        self._cm = track(self._name, **self._kwargs)
        self.run = self._cm.__enter__()
        return self.run

    def finish(self, exc: BaseException | None = None) -> None:
        if self._cm is None:
            return
        cm, self._cm = self._cm, None
        if exc is None:
            cm.__exit__(None, None, None)
        else:
            cm.__exit__(type(exc), exc, exc.__traceback__)
