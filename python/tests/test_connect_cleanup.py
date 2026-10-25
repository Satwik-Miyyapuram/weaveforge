"""connect() and `weaveforge list` close the HTTP client they open (43-09)."""

import types

import pytest

import weaveforge.container as container_mod
from weaveforge.cli import build_parser
from weaveforge.config import Settings


class FakeApi:
    """Answers whoami and the project lookup from canned replies."""

    instances: list["FakeApi"] = []

    def __init__(self, replies):
        self.replies = replies
        self.closed = False
        FakeApi.instances.append(self)

    def get(self, path, params=None):
        reply = self.replies[path]
        if isinstance(reply, Exception):
            raise reply
        return reply

    def close(self):
        self.closed = True


def _patch(monkeypatch, replies):
    FakeApi.instances = []
    monkeypatch.setattr(container_mod, "ApiClient", lambda url, token: FakeApi(replies))


SETTINGS = Settings(api_url="https://example.test", token="t", project_name="Thesis")


def test_a_rejected_token_closes_the_client(monkeypatch):
    _patch(monkeypatch, {"/api/sdk/whoami": {}})
    with pytest.raises(RuntimeError, match="no userId"):
        container_mod.connect(SETTINGS)
    assert FakeApi.instances[0].closed is True


def test_an_unknown_project_closes_the_client(monkeypatch):
    _patch(monkeypatch, {"/api/sdk/whoami": {"userId": "u"}, "/api/sdk/projects": {}})
    with pytest.raises(RuntimeError, match="No project named"):
        container_mod.connect(SETTINGS)
    assert FakeApi.instances[0].closed is True


def test_a_network_error_during_connect_closes_the_client(monkeypatch):
    _patch(monkeypatch, {"/api/sdk/whoami": ConnectionError("down")})
    with pytest.raises(ConnectionError):
        container_mod.connect(SETTINGS)
    assert FakeApi.instances[0].closed is True


def test_a_successful_connect_leaves_the_client_open(monkeypatch):
    _patch(monkeypatch, {"/api/sdk/whoami": {"userId": "u"}, "/api/sdk/projects": {"projectId": "p"}})
    c = container_mod.connect(SETTINGS)
    assert c.project_id == "p"
    assert FakeApi.instances[0].closed is False


def _fake_container(rows, fail=False):
    api = FakeApi({})

    class Experiments:
        def list(self):
            if fail:
                raise RuntimeError("server error")
            return rows

    return types.SimpleNamespace(experiments=Experiments(), api=api), api


@pytest.mark.parametrize("fail", [False, True])
def test_list_closes_the_client_it_connected(monkeypatch, fail, capsys):
    c, api = _fake_container([], fail=fail)
    monkeypatch.setattr(container_mod, "connect", lambda project=None: c)
    args = build_parser().parse_args(["list"])
    if fail:
        with pytest.raises(RuntimeError):
            args.func(args)
    else:
        assert args.func(args) == 0
    assert api.closed is True
