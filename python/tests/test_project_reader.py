"""SupabaseProjectReader.id_by_name against a fake query builder (offline)."""

from weaveforge.features.projects.infrastructure.supabase_project_reader import (
    SupabaseProjectReader,
)


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    """Records the chained builder calls and returns preset rows."""

    def __init__(self, rows, log):
        self._rows = rows
        self._log = log

    def select(self, cols):
        self._log.append(("select", cols))
        return self

    def eq(self, col, val):
        self._log.append(("eq", col, val))
        return self

    def limit(self, n):
        self._log.append(("limit", n))
        return self

    def execute(self):
        return _Result(self._rows)


class _Client:
    def __init__(self, rows):
        self._rows = rows
        self.log = []

    def table(self, name):
        self.log.append(("table", name))
        return _Query(self._rows, self.log)


def test_id_by_name_found():
    client = _Client([{"id": "p-123"}])
    reader = SupabaseProjectReader(client)
    assert reader.id_by_name("My Thesis") == "p-123"
    assert ("table", "projects") in client.log
    assert ("eq", "name", "My Thesis") in client.log


def test_id_by_name_absent():
    reader = SupabaseProjectReader(_Client([]))
    assert reader.id_by_name("Nope") is None
