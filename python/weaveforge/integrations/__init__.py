"""Framework integrations — drop-in callbacks that log a training run for you.

Most users won't hand-instrument a loop with ``run.log_metric``; a one-line
callback is the real adoption surface. Each submodule imports its framework
lazily (only when you import that submodule), so this package stays light:

    from weaveforge.integrations.lightning import WeaveForgeCallback
    from weaveforge.integrations.keras import WeaveForgeCallback

Both are thin adapters over :func:`weaveforge.track` (SRP) — they open a run
at train start, log the framework's metrics each epoch, and close it (done on
success, failed on exception).
"""
