"""Read-only contract for resolving a project by name (DIP, ISP).

Only what the SDK needs — no create/update/delete. The dashboard owns project
management; here we just map a human name to the id used for scoping.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class IProjectReader(Protocol):
    def id_by_name(self, name: str) -> str | None:
        """The id of the caller's project with this exact name, or None."""
        ...
