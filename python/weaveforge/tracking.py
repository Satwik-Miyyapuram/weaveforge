"""The decorator + context-manager entry points — the SDK's front door.

``track_experiment`` / ``track`` create the experiment (status ``running``,
auto-pinned to the local git commit), hand you a :class:`Run`, and on exit stamp
``done`` / ``failed``, flush buffered history, and pull any configured sync
sources. Everything else is a method on the ``Run``.
"""

from __future__ import annotations

import inspect
import warnings
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from functools import wraps
from typing import Any

from .features.experiments.application.git import capture_git_state
from .features.experiments.application.run import Run
from .features.experiments.domain.experiment import ExperimentStatus, NewExperimentInput
from .sync.registry import SyncRegistry, default_registry
from .sync.source import Mirror, MirrorSource


def _connect(project: str | None = None):
    from .container import connect  # lazy: only needs supabase when actually used

    return connect(project=project)



def _open_mirror(
    mirror: str | None, registry: SyncRegistry, name: str, config: Mapping[str, Any]
) -> Mirror | None:
    """Resolve ``mirror="wandb"`` to a live second home for this run's numbers.

    Named the same way sync sources are, and looked up in the same registry, so
    a user's own mirror is selected by the same argument as the built-in one.
    """
    if not mirror:
        return None
    source = registry.get(mirror)
    if not isinstance(source, MirrorSource):
        raise TypeError(f"The '{mirror}' sync source cannot mirror a live run.")
    return source.open(name=name, config=dict(config))


def _start_run(
    container: Any,
    name: str,
    *,
    config: Mapping[str, Any],
    hypothesis: str | None,
    capture_git: bool,
    registry: SyncRegistry,
    extra_input: Mapping[str, Any],
    mirror: Mirror | None = None,
) -> Run:
    input_kw = dict(extra_input)
    if capture_git:
        for key, value in capture_git_state().items():
            if value is not None:
                input_kw.setdefault(key, value)
    data = NewExperimentInput(
        name=name,
        config=dict(config),
        hypothesis=hypothesis,
        status="running",
        **input_kw,
    )
    experiment = container.manage_experiment.add(data)
    uploader = getattr(getattr(container, "artifacts", None), "upload", None)
    return Run(
        container.manage_experiment,
        experiment,
        mirror=mirror,
        uploader=uploader,
        registry=registry,
    )


@contextmanager
def track(
    name: str,
    *,
    config: Mapping[str, Any] | None = None,
    hypothesis: str | None = None,
    sync: Mapping[str, Any] | None = None,
    mirror: str | None = None,
    capture_git: bool = True,
    status_on_success: ExperimentStatus = "done",
    container: Any = None,
    project: str | None = None,
    registry: SyncRegistry | None = None,
    **experiment_fields: Any,
) -> Iterator[Run]:
    """Context manager around one run.

    ``sync`` is a mapping of ``source_id -> ref`` (e.g. ``{"tensorboard": "runs/x"}``)
    pulled on successful exit. ``mirror`` (e.g. ``"wandb"``) runs the other way:
    everything logged here is logged there too while the run happens, and the
    mirrored run is closed with this one. ``project`` (a name) scopes this run to that
    project so it shows under it in the dashboard. Pass ``container`` to reuse a
    connection or inject an in-memory one in tests; otherwise a Supabase
    connection is opened.

    A connection *this* call opened is closed on exit; a ``container`` you passed
    in is yours, so it is left open (you may still hold the ``Run``).
    """
    ctx = container or _connect(project=project)
    owns_connection = container is None
    sources = registry or default_registry
    run = _start_run(
        ctx,
        name,
        config=config or {},
        hypothesis=hypothesis,
        capture_git=capture_git,
        registry=sources,
        extra_input=experiment_fields,
        mirror=_open_mirror(mirror, sources, name, config or {}),
    )
    try:
        try:
            yield run
        except BaseException:
            _finalise_failed(run)
            raise
        else:
            if sync:
                for source_id, ref in dict(sync).items():
                    run.sync(source_id, ref)
            run.flush()
            run.set_status(status_on_success)
    finally:
        if owns_connection:
            _close_owned(ctx)


def _finalise_failed(run: Run) -> None:
    """Best-effort finalisation of a run whose body raised. Never raises.

    Order and guarding both matter. The status is written **first**, so a flush
    that cannot reach the server can no longer leave the run marked ``running``
    forever — and the flush is then still attempted, because the buffered curves
    are worth keeping. Both steps are network I/O on a machine that has just
    lost the network (usually *why* training died), so both are guarded: the
    caller's exception is the one worth propagating, and replacing it with
    ``httpx.ConnectError`` would hide the real failure. This is the deliberate
    difference from :meth:`Run.flush` on its own, which raises because there the
    caller asked for a send.
    """
    try:
        run.set_status("failed")
    except Exception as exc:  # noqa: BLE001 - never mask the training error
        warnings.warn(f"weaveforge: could not mark the run failed ({exc})", stacklevel=3)
    try:
        run.flush()
    except Exception as exc:  # noqa: BLE001 - never mask the training error
        warnings.warn(f"weaveforge: could not send metrics ({exc})", stacklevel=3)


def _close_owned(container: Any) -> None:
    """Release the HTTP pool of a container :func:`track` opened for itself.

    Only called when ``track`` created the connection: an injected container
    belongs to the caller, who may keep using the ``Run`` (or their own
    connection) after the block. Best-effort, like the rest of finalisation — a
    close that fails must not turn a successful run into a raised one.
    """
    close = getattr(getattr(container, "api", None), "close", None)
    if not callable(close):
        return
    try:
        close()
    except Exception as exc:  # noqa: BLE001
        warnings.warn(f"weaveforge: could not close the API client ({exc})", stacklevel=3)


def track_experiment(
    name: str | None = None,
    *,
    config: Mapping[str, Any] | None = None,
    capture_hyperparams: bool = True,
    inject: str = "run",
    **track_kwargs: Any,
) -> Callable[[Callable], Callable]:
    """Decorator form. Wraps a training function so it becomes a tracked run.

    - If the function declares a parameter named ``inject`` (default ``run``),
      the live :class:`Run` is passed to it.
    - Simple keyword hyperparameters are captured into ``config`` automatically
      (explicit ``config`` wins).
    - A ``dict`` return value is recorded as summary metrics.
    """

    def decorator(fn: Callable) -> Callable:
        wants_run = inject in inspect.signature(fn).parameters

        @wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            cfg: dict[str, Any] = dict(config or {})
            if capture_hyperparams:
                for key, value in kwargs.items():
                    if key == inject:
                        continue
                    if value is None or isinstance(value, (str, int, float, bool)):
                        cfg.setdefault(key, value)
            with track(name or fn.__name__, config=cfg, **track_kwargs) as run:
                if wants_run:
                    kwargs.setdefault(inject, run)
                result = fn(*args, **kwargs)
                if isinstance(result, dict):
                    run.log_summary(result)
                return result

        return wrapper

    return decorator
