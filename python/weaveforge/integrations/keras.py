"""Keras callback (Keras 3 or tf.keras).

    from weaveforge.integrations.keras import WeaveForgeCallback
    model.fit(..., callbacks=[WeaveForgeCallback(name="cnn", project="My Thesis")])

Opens a run at train start, logs each epoch's ``logs`` dict, and closes it on
train end.
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
        if self._session:
            self._session.finish()
