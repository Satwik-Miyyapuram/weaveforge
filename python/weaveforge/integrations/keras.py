"""Keras callback (Keras 3 or tf.keras).

    from weaveforge.integrations.keras import WeaveForgeCallback
    model.fit(..., callbacks=[WeaveForgeCallback(name="cnn", project="My Thesis")])

Opens a run at train start, logs each epoch's ``logs`` dict, and closes it on
train end — ``done`` on success, ``failed`` when the run did not finish.

## The failure path, and why it needs one line of caller code

PyTorch Lightning hands its callbacks the exception (``on_exception``); Keras 3
does not. There is no exception hook on ``keras.callbacks.Callback``, and
``callbacks.on_train_end()`` is called *after* the epoch loop in
``keras/src/backend/*/trainer.py`` — so when ``fit`` raises, no callback hook
runs at all and the run would be left open, ``running``, with its buffered curve
unsent. There is no callback-only way to detect that from inside Keras.

So the failure path is explicit, and mirrors Lightning's hook:

    callback = WeaveForgeCallback(name="cnn")
    try:
        model.fit(x, y, callbacks=[callback])
    except BaseException as exc:
        callback.close(exc)      # records the run as failed, flushes what it has
        raise

``close(exc)`` is safe to call after a successful ``fit`` (the session is gone,
so it is a no-op) and safe to call twice, so it can live in a bare ``except``
without further thought. A caller that skips it gets exactly what Keras gives a
callback: a run left ``running`` until it is abandoned on the dashboard.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

try:
    import keras
except ImportError:  # pragma: no cover
    try:
        from tensorflow import keras  # type: ignore[no-redef]
    except ImportError as exc:  # pragma: no cover
        raise ImportError(
            "Keras is required for this callback. "
            "Install it with: pip install 'weaveforge[keras]'"
        ) from exc

from ._common import RunSession, to_scalars


class WeaveForgeCallback(keras.callbacks.Callback):
    def __init__(
        self,
        name: str | None = None,
        *,
        project: str | None = None,
        config: Mapping[str, Any] | None = None,
        **track_kwargs: Any,
    ) -> None:
        super().__init__()
        self._name = name or "keras-run"
        self._project = project
        self._config = dict(config or {})
        self._track_kwargs = track_kwargs
        self._session: RunSession | None = None

    def on_train_begin(self, logs: Mapping[str, Any] | None = None) -> None:
        self._session = RunSession(
            self._name, project=self._project, config=self._config, **self._track_kwargs
        )
        self._session.start()

    def on_epoch_end(self, epoch: int, logs: Mapping[str, Any] | None = None) -> None:
        if not self._session or self._session.run is None:
            return
        for name, value in to_scalars(logs).items():
            self._session.run.log_metric(name, value, step=int(epoch))

    def on_train_end(self, logs: Mapping[str, Any] | None = None) -> None:
        """Training reached its end without raising: the run is ``done``.

        Keras does not tell this hook whether training *succeeded*, only that it
        stopped — the exception case never gets here at all (see the module
        docstring). A caller that needs an interrupted ``fit`` recorded as failed
        calls :meth:`close` with the exception.
        """
        if self._session:
            self._session.finish()

    def close(self, exc: BaseException | None = None) -> None:
        """Finish the run, marking it failed when ``exc`` is given.

        The Keras counterpart of Lightning's ``on_exception``. Idempotent: after
        the first call (by ``on_train_end`` or by this method) there is no
        session left, so a later call does nothing — calling it in a bare
        ``except`` after a ``fit`` that actually succeeded costs nothing.
        """
        if self._session:
            self._session.finish(exc)
