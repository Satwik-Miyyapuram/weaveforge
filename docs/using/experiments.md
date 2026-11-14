---
covers:
  - apps/web/src/features/experiments
  - crates/wf-core/src/experiments.rs
  - crates/wf-core/src/experiment_rows.rs
checked: 2026-11-13
---
# Experiments

An experiment is one run you can point at: what you changed, what came out, and
which paper it came from. You can create one by hand on the Experiments screen,
or a training script can log it for you with the Python SDK.

## How to

### Create an experiment by hand

1. On the Experiments screen, click **New experiment**. The dialog is titled
   "New experiment".
2. Type a **Name**. It is required. The placeholder is `beta-vae sweep β=4`.
3. Optionally fill **Branch** (placeholder `main`), **Commit** (placeholder
   `a1b2c3d`) and **Repo URL** (placeholder `https://github.com/you/thesis-experiments`).
4. Choose a **Status**. It starts as `planned`.
5. Optionally paste **Config (JSON)**, for example `{"beta":4,"latent_dim":32,"seed":0}`.
6. Click **Create**. The button reads "Creating…" while the experiment is saved.
7. A toast says "Experiment created". Click **Open** in the toast to see it.

### Log a run from Python

1. Make a token in the app. On the desktop app, click **More**, then **Python SDK
   token**. It opens Settings → Access tokens. A new token starts with the
   Experiments permission.
2. Give the script the token and the API address in its environment:
   `WEAVEFORGE_TOKEN` and `WEAVEFORGE_API_URL`. If the desktop app is connected
   (Settings → AI & MCP, then Connect), the script can find it without them.
3. Wrap the code you want recorded with the decorator, or use the context manager:

   ```python
   from weaveforge import track_experiment

   @track_experiment(name="beta-vae sweep", config={"beta": 4})
   def train(run):
       run.log_metric("val_loss", 0.11, step=100)
       return {"val_loss": 0.11}   # recorded as summary metrics
   ```

   ```python
   from weaveforge import track

   with track("beta-vae sweep", config={"beta": 4}) as run:
       run.log_metric("val_loss", 0.11, step=100)
   ```

4. Open the Experiments screen. The run is there. Its curves appear on the
   experiment's page.

### Compare runs

1. On the Experiments screen, the view switch has two views: **Cards** and
   **Compare**. Choose **Compare**.
2. The first three runs are ticked. Tick or untick others with their checkboxes.
3. Click a metric's column heading to sort by it. Click it again to reverse.
4. To see fewer runs, use **Status** in the filter row, or type in **Search experiments**.

### Delete an experiment

1. On the experiment's card, open the card menu (**More actions for <name>**) and choose
   **Delete experiment**. There is no confirm dialog.
2. The card disappears at once and a toast reads `"<name>" deleted` with **Undo**.
3. The delete runs when the toast closes, after 8 seconds or when you close it. Click
   **Undo** before that to keep the experiment.

## Reference

### Statuses

| Status | Meaning |
|---|---|
| `planned` | Not started. The default for a new experiment. |
| `running` | In progress. The screen re-checks it in the background. |
| `done` | Finished. The default when a `track` run exits without error. |
| `failed` | Your code raised an error inside a `track` run. |
| `abandoned` | Marked by WeaveForge when a `running` run has gone stale. |

### Limits and validation

| Case | What happens |
|---|---|
| **Name** is empty | The form does not submit (the field is required). From Python, the error is `Experiment name is required.` |
| **Config (JSON)** is not valid JSON | Creation stops with `Config must be valid JSON:` followed by the parser's reason. |
| `log_metric` with no `step` | Stored as a summary value, not a curve. |
| `log_figure` or `log_bytes` on a bare run | Raises `RuntimeError`. Use a run from `track()` or `track_experiment()`. |
| Experiment id not found | The page shows `Experiment not found.` |

### Messages

| Message | Where | Cause |
|---|---|---|
| No experiments yet | Experiments screen | No experiments exist. Body: "An experiment is one run you can point at…" |
| No experiments match. | Experiments screen | Filters or search hide everything. Use **Clear filters**. |
| No runs to compare yet. | Compare view | No experiments exist. |
| "<name>" deleted | Toast, with **Undo** | You deleted an experiment. |
| Selected runs have no logged curves to overlay yet. | Compare view | The ticked runs have no curve data. |
| No curve data yet — log metrics with a step via the Python SDK | Experiment page, Metrics | The run has no metrics with a step. |
| Nothing attached yet. Runs log their own; add one here. | Experiment page, Figures & artifacts | No files or links. |
| Missing required environment variables: … | Python SDK | `WEAVEFORGE_TOKEN` or `WEAVEFORGE_API_URL` is not set and no desktop connection is found. |

## How it works

The Experiments screen is the feature in `apps/web/src/features/experiments/`.
The page at `apps/web/src/app/experiments/page.tsx` renders its `ExperimentsScreen`.
The status list and the rules for stale runs live in `packages/core/src/features/experiments/`
and in Rust.

The Python SDK is in `python/weaveforge/`. `track` and `track_experiment` are in
`python/weaveforge/tracking.py`. `Run` is in
`python/weaveforge/features/experiments/application/run.py`. It writes to the
same store the screen reads, through the token you gave it.

A run that is still `running` is re-checked when the screen loads, and the
screen refreshes it in the background while it is live.

## Related

- [Papers](papers.md) — papers an experiment can point at
- [Workspace folder](workspace-folder.md) — access tokens and local access for other apps
- [Search](search.md) — finding experiments by name, hypothesis or result
