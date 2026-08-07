"""PyTorch Lightning callback.

    from weaveforge.integrations.lightning import WeaveForgeCallback
    trainer = Trainer(callbacks=[WeaveForgeCallback(project="My Thesis")])

Opens a run at fit start (config seeded from ``pl_module.hparams``), logs
``trainer.callback_metrics`` each epoch, and closes it — done on success,
failed if training raises.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

try:  # support both the new `lightning` and legacy `pytorch_lightning`
    from lightning.pytorch.callbacks import Callback
except ImportError:  # pragma: no cover
    try:
        from pytorch_lightning.callbacks import Callback
    except ImportError as exc:  # pragma: no cover
        raise ImportError(
            "PyTorch Lightning is required for this callback. "
            "Install it with: pip install 'weaveforge[lightning]'"
        ) from exc

from ._common import RunSession, to_scalars


class WeaveForgeCallback(Callback):
    def __init__(
        self,
        name: str | None = None,
        *,
        project: str | None = None,
        config: Mapping[str, Any] | None = None,
        step: str = "global",  # "global" (global_step) or "epoch"
        **track_kwargs: Any,
    ) -> None:
        super().__init__()
        self._name = name
        self._project = project
        self._config = dict(config or {})
        self._step_mode = step
        self._track_kwargs = track_kwargs
        self._session: RunSession | None = None

    def on_fit_start(self, trainer: Any, pl_module: Any) -> None:
        cfg = self._config
        hparams = getattr(pl_module, "hparams", None)
        if hparams:
            try:
                cfg = {**dict(hparams), **cfg}  # explicit config wins
            except Exception:
                pass
        name = self._name or type(pl_module).__name__
        self._session = RunSession(
            name, project=self._project, config=cfg, **self._track_kwargs
        )
        self._session.start()

    def _log(self, trainer: Any) -> None:
        if not self._session or self._session.run is None:
            return
        step = trainer.global_step if self._step_mode == "global" else trainer.current_epoch
        for name, value in to_scalars(trainer.callback_metrics).items():
            self._session.run.log_metric(name, value, step=int(step))

    def on_train_epoch_end(self, trainer: Any, pl_module: Any) -> None:
        self._log(trainer)

    def on_validation_epoch_end(self, trainer: Any, pl_module: Any) -> None:
        self._log(trainer)

    def on_fit_end(self, trainer: Any, pl_module: Any) -> None:
        if self._session:
            self._session.finish()

    def on_exception(self, trainer: Any, pl_module: Any, exception: BaseException) -> None:
        if self._session:
            self._session.finish(exception)
