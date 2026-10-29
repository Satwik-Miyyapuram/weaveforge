"""verify_sharing.py reports skipped checks instead of calling the run a pass (43-11)."""

import importlib.util
import sys
import types
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "verify_sharing.py"


@pytest.fixture
def vs(monkeypatch):
    # The script needs the supabase client at import; the summary does not.
    for name, attr in (("postgrest", "SyncPostgrestClient"), ("supabase", "create_client")):
        module = types.ModuleType(name)
        setattr(module, attr, object)
        monkeypatch.setitem(sys.modules, name, module)
    spec = importlib.util.spec_from_file_location("verify_sharing_under_test", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_every_check_passing_with_nothing_skipped_is_a_pass(vs, capsys):
    vs.check(True, "one")
    vs.check(True, "two")
    assert vs.summary() == 0
    assert "All 2 checks passed." in capsys.readouterr().out


def test_a_failure_fails_the_run(vs):
    vs.check(True, "one")
    vs.check(False, "two")
    vs.skip("three")
    assert vs.summary() == 1


def test_a_skip_is_counted_and_named_instead_of_reading_as_a_full_pass(vs, capsys):
    vs.check(True, "one")
    vs.skip("hierarchy checks: TT_C/D/E_* not all set")
    capsys.readouterr()
    assert vs.summary() == 0
    out = capsys.readouterr().out
    assert "All checks passed" not in out
    assert "1 passed, 1 skipped" in out
    assert "hierarchy checks: TT_C/D/E_* not all set" in out


def test_skip_prints_a_skip_line(vs, capsys):
    vs.skip("switcher checks")
    assert capsys.readouterr().out.strip() == "SKIP: switcher checks"


def test_a_run_that_checked_nothing_fails(vs):
    vs.skip("everything")
    assert vs.summary() == 1
