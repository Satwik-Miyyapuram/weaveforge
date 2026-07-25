"""Framework integrations — drop-in callbacks that log a training run for you.

Most users won't hand-instrument a loop with ``run.log_metric``; a one-line
callback is the real adoption surface. Each submodule imports its framework
lazily (only when you import that submodule), so this package stays light:

    from thesis_tracker.integrations.lightning import ThesisTrackerCallback
    from thesis_tracker.integrations.keras import ThesisTrackerCallback

Both are thin adapters over :func:`thesis_tracker.track` (SRP) — they open a run
at train start, log the framework's metrics each epoch, and close it (done on
success, failed on exception).
"""
