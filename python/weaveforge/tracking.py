"""The decorator + context-manager entry points — the SDK's front door.

``track_experiment`` / ``track`` create the experiment (status ``running``,
auto-pinned to the local git commit), hand you a :class:`Run`, and on exit stamp
``done`` / ``failed``, flush buffered history, and pull any configured sync
sources. Everything else is a method on the ``Run``.

Two properties this module has to hold, because everything else here is
convenience:

* **A run always ends in a terminal status.** The exit path does network I/O on
  a machine that has usually just lost the network — that is often *why* the
  training stopped — so the status write is guarded and the steps that can fail
  are attempted without being able to skip it. It is written in one place,
  :func:`_finalise`, for both exits; the two used to be written separately and
  disagreed about exactly this.
* **A resource acquired here is released here.** The connection and the mirror
  are both opened before the run exists, so both are opened inside the guarded
  region: an exception while creating the experiment must still close them.
"""

from __future__ import annotations

import inspect
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from functools import partial, wraps
from typing import Any

from .features.experiments.application.git import capture_git_state
from .features.experiments.application.run import Run
from .features.experiments.domain.experiment import ExperimentStatus, NewExperimentInput
from .shared.guards import USER_FRAME, best_effort
from .shared.ports import TrackingContainer, api_closer, artifact_uploader
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


def _release_mirror(mirror: Mirror | None) -> None:
    """Close a mirror that was opened for a run that never came into existence.

    A mirror is a live run on somebody else's service. The only thing that ever
    finishes one is :meth:`Run.set_status`, so if the experiment creation fails
    after the mirror opened, nothing is left that will ever close it.
    """
    if mirror is None:
        return
    best_effort("close the mirror", lambda: mirror.finish("failed"))


def _start_run(
    container: TrackingContainer,
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
    return Run(
        container.manage_experiment,
        experiment,
        mirror=mirror,
        uploader=artifact_uploader(container),
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
    container: TrackingContainer | None = None,
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

    A ``sync`` or flush that fails on the way out raises, after the run has been
    given its terminal status — so the dashboard never shows a finished run as
    still running, and you still hear about the failed send. On the failure path
    (your code raised) the opposite holds: the send is attempted, warned about,
    and never allowed to replace your exception.
    """
    ctx = container or _connect(project=project)
    owns_connection = container is None
    sources = registry or default_registry
    # From here on, everything acquired is released by the `finally` — including
    # the connection, which used to be opened above the guard and so leaked
    # whenever creating the experiment failed.
    try:
        mirror_handle = _open_mirror(mirror, sources, name, config or {})
        try:
            run = _start_run(
                ctx,
                name,
                config=config or {},
                hypothesis=hypothesis,
                capture_git=capture_git,
                registry=sources,
                extra_input=experiment_fields,
                mirror=mirror_handle,
            )
        except BaseException:
            _release_mirror(mirror_handle)
            raise
        try:
            yield run
        except BaseException:
            _finalise(run, status="failed")
            raise
        else:
            _finalise(run, status=status_on_success, sync=sync, strict=True)
    finally:
        if owns_connection:
            _close_owned(ctx)


def _finalise(
    run: Run,
    *,
    status: ExperimentStatus,
    sync: Mapping[str, Any] | None = None,
    strict: bool = False,
) -> None:
    """End a run: one implementation, both exits.

    Order is the whole argument. The steps that can fail run **first**, and the
    terminal status is written **last, under a guard**. Written last because
    :meth:`Run.set_status` is also what tells a mirror the run is over: stamping
    the status first would finish the mirrored run and then attach artifacts to
    an experiment the mirror had already closed, leaving the two disagreeing
    about the same run. Guarded because no failure above it may skip it — that
    is the bug this replaces, where a failing flush on the success path left the
    experiment marked ``running`` for ever.

    ``strict`` is the only difference between the two callers. On the failure
    path the caller is already carrying their own exception, and replacing it
    with ``httpx.ConnectError`` would hide the real failure, so the first send
    error is warned about and swallowed. On the success path there is no earlier
    exception to protect, so the first error is re-raised after the status has
    been written — the run is genuinely over, its numbers are not, and the
    caller is the one who can do something about that.

    Note what is *not* done here: a failed send does not downgrade the status to
    ``failed``. Training succeeded; a send failed. Marking the experiment failed
    would misreport the result the dashboard exists to show, and the caller is
    told directly.
    """
    first_failure: Exception | None = None

    if sync:
        for source_id, ref in dict(sync).items():
            failed = best_effort(
                f"sync '{source_id}'",
                partial(run.sync, source_id, ref),
                stacklevel=USER_FRAME,
            )
            if first_failure is None:
                first_failure = failed

    flushed = best_effort("send metrics", run.flush, stacklevel=USER_FRAME)
    if first_failure is None:
        first_failure = flushed

    best_effort(
        f"mark the run {status}",
        lambda: run.set_status(status),
        stacklevel=USER_FRAME,
    )

    if strict and first_failure is not None:
        raise first_failure


def _close_owned(container: TrackingContainer) -> None:
    """Release the HTTP pool of a container :func:`track` opened for itself.

    Only called when ``track`` created the connection: an injected container
    belongs to the caller, who may keep using the ``Run`` (or their own
    connection) after the block. Best-effort, like the rest of finalisation — a
    close that fails must not turn a successful run into a raised one.
    """
    api = api_closer(container)
    if api is None:
        return
    best_effort("close the API client", api.close, stacklevel=USER_FRAME)


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
    - Hyperparameters are captured from the arguments **as they were passed**,
      positional or keyword (explicit ``config`` wins).
    - A ``dict`` return value is recorded as summary metrics.
    - ``async def`` functions get an async wrapper, so the run is not stamped
      ``done`` before the first step has run.
    """

    def decorator(fn: Callable) -> Callable:
        signature = inspect.signature(fn)
        wants_run = inject in signature.parameters

        def bind(args: tuple[Any, ...], kwargs: dict[str, Any]):
            """Bind the call once, before anything is injected into it.

            Binding rather than writing into ``kwargs`` is what makes a
            positional call work: ``setdefault`` can only fill a parameter by
            keyword, so a caller passing the run slot positionally got "got
            multiple values for argument" and a hyperparameter passed
            positionally was captured as nothing at all.
            """
            return signature.bind_partial(*args, **kwargs)

        def captured(bound) -> dict[str, Any]:
            """Simple hyperparameters from what was actually passed."""
            cfg: dict[str, Any] = dict(config or {})
            if capture_hyperparams:
                for key, value in bound.arguments.items():
                    if key == inject:
                        continue
                    if value is None or isinstance(value, (str, int, float, bool)):
                        cfg.setdefault(key, value)
            return cfg

        def invoke(bound, run: Run) -> Any:
            if wants_run and inject not in bound.arguments:
                bound.arguments[inject] = run
            return fn(*bound.args, **bound.kwargs)

        if inspect.iscoroutinefunction(fn):

            @wraps(fn)
            async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
                bound = bind(args, kwargs)
                with track(name or fn.__name__, config=captured(bound), **track_kwargs) as run:
                    result = await invoke(bound, run)
                    if isinstance(result, dict):
                        run.log_summary(result)
                    return result

            return async_wrapper

        @wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            bound = bind(args, kwargs)
            with track(name or fn.__name__, config=captured(bound), **track_kwargs) as run:
                result = invoke(bound, run)
                if isinstance(result, dict):
                    run.log_summary(result)
                return result

        return wrapper

    return decorator
