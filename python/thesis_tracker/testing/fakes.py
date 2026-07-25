"""Deterministic Clock / IdGenerator fakes for pure unit tests."""

from __future__ import annotations


class FixedClock:
    def __init__(self, iso: str = "2026-06-24T12:00:00.000Z") -> None:
        self._iso = iso

    def now_iso(self) -> str:
        return self._iso


class SeqIdGenerator:
    def __init__(self, prefix: str = "id-") -> None:
        self._prefix = prefix
        self._n = 0

    def new_id(self) -> str:
        self._n += 1
        return f"{self._prefix}{self._n}"
