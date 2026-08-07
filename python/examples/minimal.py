"""Minimal decorator example.

Run against a real project (set the WEAVEFORGE_* env vars first)::

    python examples/minimal.py

Everything flows through the decorator: it creates the experiment, pins it to
your current git commit, hands the function a `run`, records the returned dict
as summary metrics, and marks the run done (or failed) on exit.
"""

import math

from weaveforge import track_experiment


@track_experiment(name="beta-vae demo", config={"latent_dim": 32})
def train(run, beta: float = 4.0, epochs: int = 20):
    val_loss = 1.0
    for step in range(epochs):
        val_loss = math.exp(-step / 8) + 0.1
        run.log_metric("val_loss", val_loss, step=step)
        run.log_metric("beta", beta, step=step)
    return {"val_loss": round(val_loss, 4)}


if __name__ == "__main__":
    train(beta=4.0)
    print("done — open the Experiments tab in the dashboard.")
