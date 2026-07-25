"""Supabase adapter implementing :class:`IProjectReader`. RLS already scopes the
`projects` table to the signed-in user, so a name lookup only ever sees their
own projects."""

from __future__ import annotations

from typing import Any

_TABLE = "projects"


class SupabaseProjectReader:
    def __init__(self, client: Any) -> None:
        self._db = client

    def id_by_name(self, name: str) -> str | None:
        res = (
            self._db.table(_TABLE)
            .select("id")
            .eq("name", name)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        return rows[0]["id"] if rows else None
