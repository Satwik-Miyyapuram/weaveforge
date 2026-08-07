"""Time + id abstractions.

Domain factories stay pure and testable by depending on these instead of
calling ``datetime``/``uuid`` directly. Concrete implementations are injected
at the composition root (``container.py``). Port of
``packages/core/src/shared/clock.ts``.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Protocol, runtime_checkable


@runtime_checkable
class Clock(Protocol):
    def now_iso(self) -> str:
        """ISO-8601 timestamp, e.g. ``2026-06-24T12:00:00.000Z``."""
        ...


@runtime_checkable
class IdGenerator(Protocol):
    def new_id(self) -> str: ...


class SystemClock:
    """Real clock — UTC, millisecond precision, ``Z`` suffix like the web app."""

    def now_iso(self) -> str:
        now = datetime.now(timezone.utc)
        return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


class UuidGenerator:
    def new_id(self) -> str:
        return str(uuid.uuid4())


def iso_date(iso: str) -> str:
    """Calendar date (yyyy-mm-dd) from an ISO timestamp."""
    return iso[:10]
