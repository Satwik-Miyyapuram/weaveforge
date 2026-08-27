# weaveforge (Python SDK)

**Push ML experiments into the same dashboard as your papers and thesis plan.**

The [WeaveForge](../README.md) web app tracks literature, milestones, and report progress. This package connects your **training scripts** to that same Supabase database — runs, step-indexed curves, and figure artifacts show up under **Experiments** without a separate wandb/MLflow silo.

## Why use it

| Problem | This SDK |
|---------|----------|
| Experiment logs live in TensorBoard; thesis context lives elsewhere | One DB: link runs to `related_paper`, compare sweeps in the PWA |
| Wiring a custom API for every project | Same RLS + migrations as the web app — self-host once |
| Heavy MLOps platforms | Lightweight decorator + optional Lightning/Keras callbacks |

## Install

```bash
pip install weaveforge                 # core (supabase + httpx)
pip install 'weaveforge[figures]'      # matplotlib/Pillow artifacts
pip install 'weaveforge[tensorboard]'  # tbparse import
pip install 'weaveforge[wandb]'        # wandb import
pip install 'weaveforge[all,dev]'      # everything + pytest
```

Sync sources register at import time but stay unavailable until their extra is installed (clear error if you call one without deps).

## Configure

Generate a personal access token in the web app (**Settings → Python SDK access tokens**).
Tokens are created on demand, stored hashed server-side, and shown once — like GitHub or PyPI.
Use them with the [`weaveforge`](https://pypi.org/project/weaveforge/) package:

```bash
pip install weaveforge
export WEAVEFORGE_TOKEN=tt_...
export WEAVEFORGE_API_URL=http://localhost:3000
export WEAVEFORGE_PROJECT="My Thesis"   # or WEAVEFORGE_PROJECT_ID=<uuid>
```

The SDK sends the token to your WeaveForge instance, which validates it and applies row-level security as your user.

### Against the desktop app, with no account

The desktop app serves the same routes from the database in your folder, so a
training script can write into a copy that has never signed in. Turn the local
API on in **Settings → Let other apps in**, copy the token it shows, and point the SDK
at the loopback port:

```bash
export WEAVEFORGE_TOKEN=<the token the app shows>
export WEAVEFORGE_API_URL=http://127.0.0.1:27123
export WEAVEFORGE_PROJECT="My Thesis"
```

Nothing else changes: the same `track(...)`, the same runs and curves, and the
app shows them under **Experiments** as they arrive. The app has to be running,
and the port only listens on `127.0.0.1` — no other machine can reach it.

Apply migrations through at least `0017` (metrics + artifacts bucket) — see root [README § Database](../README.md#database).

## Quick example

```python
from weaveforge import track_experiment

@track_experiment(name="beta-vae sweep", config={"latent_dim": 32},
                  sync={"tensorboard": "runs/beta4"})
def train(run, beta=4.0):
    for step in range(100):
        run.log_metric("val_loss", loss(step), step=step)
    run.log_figure(fig, name="reconstruction")
    return {"val_loss": 0.11}

train(beta=4.0)
```

- **`@track_experiment`** — creates row (`running`), pins git state, logs metrics, uploads figures, sets `done`/`failed` on exit.
- **`with track(...) as run:`** — same without a decorator.
- **Callbacks** — `weaveforge.integrations.lightning.WeaveForgeCallback`, `.keras.WeaveForgeCallback`.

## CLI

```bash
weaveforge list --project "My Thesis"
weaveforge import-tb runs/beta4 --name "beta-vae sweep"
weaveforge import-wandb entity/project/run_id
```

## Extend (Open/Closed)

Implement `MetricSource` (`id`, `available()`, `read(ref)`), register on `default_registry`, use `track(sync={"my_source": ref})`. Example: `examples/custom_source.py`.

## Architecture

Mirrors the web app: `features/experiments/{domain,application,infrastructure}`, `container.py` composition root, repository interfaces tested with in-memory fakes. **No duplicate schema** — migrations in `../supabase/migrations/` are the contract.

## Test

```bash
pip install -e '.[dev]'
pytest   # offline; Supabase integration test skips without env creds
```

## More

- Root pitch + web app: [../README.md](../README.md)
- Design principles: [../docs/DESIGN.md](../docs/DESIGN.md)
