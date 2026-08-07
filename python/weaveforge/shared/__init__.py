"""Cross-cutting contracts shared by every feature module.

Mirrors ``packages/core/src/shared`` on the TypeScript side: generic
repository interfaces and the time/id abstractions that keep domain
factories pure and testable (see ``docs/DESIGN.md`` §5.1).
"""

from .clock import Clock, IdGenerator, SystemClock, UuidGenerator, iso_date
from .repository import (
    Identifiable,
    IReadableRepository,
    IRepository,
    IWritableRepository,
)

__all__ = [
    "Clock",
    "IdGenerator",
    "SystemClock",
    "UuidGenerator",
    "iso_date",
    "Identifiable",
    "IReadableRepository",
    "IWritableRepository",
    "IRepository",
]
