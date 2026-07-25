"""Stream metrics + exercise all SDK sync integrations in one live run.

Integrations tested (when optional deps are installed):

- **Direct SDK** — ``log_metric``, ``log_figure``, ``log_bytes``, ``log_artifact``
- **matplotlib** — ``run.sync("matplotlib", None)`` sweeps open figures → WebP/PNG
- **tensorboard** — writes a local logdir, ``run.sync_tensorboard`` + exit ``sync``
- **wandb** — live ``wandb.log`` + ``run.sync_wandb`` on exit (needs ``WANDB_API_KEY``)

Install everything:

    pip install 'thesis-tracker[all]' tensorboard torch

Run via the helper script or directly:

    node scripts/live-dummy-experiment-c.mjs
    python examples/live_dummy_run.py
"""

from __future__ import annotations

import math
import os

# Windows: PyTorch (libiomp5) and NumPy/MKL (libomp) may both load OpenMP.
# Set before torch/matplotlib import — required for SummaryWriter + pyplot together.
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
# Headless plots — avoids Qt QThreadStorage warnings when torch is also loaded.
os.environ.setdefault("MPLBACKEND", "Agg")

import shutil
import tempfile
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from thesis_tracker import track
from thesis_tracker.sync import default_registry

STEP_SLEEP_SEC = float(os.environ.get("LIVE_DUMMY_STEP_SEC", "3"))
MAX_STEPS = int(os.environ.get("LIVE_DUMMY_STEPS", "40"))
FIGURE_EVERY = int(os.environ.get("LIVE_DUMMY_FIGURE_EVERY", "15"))


@dataclass
class IntegrationStatus:
    matplotlib: bool = False
    tensorboard_write: bool = False
    tensorboard_read: bool = False
    wandb: bool = False
    pillow: bool = False
    notes: list[str] = field(default_factory=list)


def _probe_integrations() -> IntegrationStatus:
    st = IntegrationStatus()
    st.matplotlib = default_registry.get("matplotlib").available()
    st.tensorboard_read = default_registry.get("tensorboard").available()
    st.wandb = default_registry.get("wandb").available()
    try:
        from PIL import Image  # noqa: F401

        st.pillow = True
    except ImportError:
        pass
    try:
        from torch.utils.tensorboard import SummaryWriter  # noqa: F401

        st.tensorboard_write = True
    except ImportError:
        st.notes.append("tensorboard write: pip install tensorboard torch")
    if not st.matplotlib:
        st.notes.append("matplotlib: pip install matplotlib")
    if not st.tensorboard_read:
        st.notes.append("tensorboard read: pip install 'thesis-tracker[tensorboard]'")
    if not st.wandb:
        st.notes.append("wandb: pip install 'thesis-tracker[wandb]'")
    return st


def _experiment_name() -> str:
    if custom := os.environ.get("LIVE_DUMMY_NAME", "").strip():
        return custom
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    return f"SDK integration demo — {stamp}"


def _dashboard_url(experiment_id: str) -> str:
    base = os.environ.get("THESIS_TRACKER_API_URL", "http://localhost:3000").rstrip("/")
    return f"{base}/experiments/{experiment_id}"


def _open_tensorboard_writer(logdir: Path) -> Any | None:
    try:
        from torch.utils.tensorboard import SummaryWriter

        return SummaryWriter(log_dir=str(logdir))
    except ImportError:
        return None


def _disable_wandb_if_no_key() -> None:
    """Avoid interactive wandb login prompts when no API key is configured."""
    if os.environ.get("WANDB_API_KEY", "").strip():
        return
    os.environ.setdefault("WANDB_MODE", "disabled")
    os.environ.setdefault("WANDB_SILENT", "true")


def _start_wandb_run(name: str) -> tuple[Any | None, str | None]:
    if not default_registry.get("wandb").available():
        return None, None
    if not os.environ.get("WANDB_API_KEY", "").strip():
        return None, None
    try:
        import wandb
    except ImportError:
        return None, None

    mode = os.environ.get("WANDB_MODE", "online")
    wandb.init(
        project=os.environ.get("WANDB_PROJECT", "thesis-tracker-demo"),
        name=name[:128],
        mode=mode,
        reinit=True,
    )
    entity = wandb.run.entity
    project = wandb.run.project
    run_id = wandb.run.id
    return wandb, f"{entity}/{project}/{run_id}"


def _matplotlib_pyplot():
    """Import pyplot with Agg backend (safe alongside torch on Windows)."""
    import matplotlib

    if matplotlib.get_backend().lower() != "agg":
        matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    return plt


def _upload_initial_gallery(run) -> list[str]:
    plt = _matplotlib_pyplot()
    import numpy as np

    uploaded: list[str] = []
    rng = np.random.default_rng(7)

    def save(fig, name: str, fmt: str = "png") -> None:
        run.log_figure(fig, name=name, fmt=fmt)
        uploaded.append(name if "." in name else f"{name}.{fmt}")
        plt.close(fig)

    fig, ax = plt.subplots(figsize=(6, 4), dpi=120)
    xs = np.linspace(0, 4 * math.pi, 100)
    ax.plot(xs, np.sin(xs), label="sin")
    ax.plot(xs, 0.5 * np.cos(xs), label="cos")
    ax.legend(fontsize=8)
    ax.set_title("Waveform (log_figure)")
    fig.tight_layout()
    save(fig, "sdk-waveform")

    fig, ax = plt.subplots(figsize=(5, 4), dpi=120)
    ax.bar(["a", "b", "c", "d"], [3, 7, 2, 5], color="#5b8def")
    ax.set_title("Bar chart (log_figure)")
    fig.tight_layout()
    save(fig, "sdk-bar-chart")

    fig, ax = plt.subplots(figsize=(5, 4), dpi=120)
    grid = rng.random((8, 8))
    ax.imshow(grid, cmap="magma")
    ax.set_title("Heatmap (log_figure)")
    fig.tight_layout()
    save(fig, "sdk-heatmap")

    svg = """<svg xmlns="http://www.w3.org/2000/svg" width="280" height="160">
  <rect width="280" height="160" fill="#161b22"/>
  <text x="140" y="85" text-anchor="middle" fill="#8b949e" font-family="sans-serif" font-size="16">SDK inline SVG</text>
</svg>"""
    run.log_bytes("sdk-inline.svg", svg.encode("utf-8"), "image/svg+xml")
    uploaded.append("sdk-inline.svg")

    run.log_artifact("https://wandb.ai/demo/thesis-tracker/runs/integration-demo")
    return uploaded


def _leave_matplotlib_figures_open() -> None:
    """Create figures left open for ``sync('matplotlib', None)`` to sweep."""
    plt = _matplotlib_pyplot()
    import numpy as np

    for i, cmap in enumerate(["viridis", "plasma", "cividis"], start=1):
        fig, ax = plt.subplots(figsize=(4.5, 3.5), dpi=120)
        ax.plot(np.linspace(0, 1, 30) ** (i * 0.3), color=f"C{i - 1}", linewidth=2)
        ax.set_title(f"Open figure {i} (matplotlib sync)")
        fig.tight_layout()


def _upload_step_figures(run, step: int, losses: list[float], accs: list[float]) -> list[str]:
    if step <= 0 or FIGURE_EVERY <= 0 or step % FIGURE_EVERY != 0 or not losses:
        return []
    plt = _matplotlib_pyplot()

    fig, ax = plt.subplots(figsize=(7, 4), dpi=120)
    xs = list(range(len(losses)))
    ax.plot(xs, losses, label="loss", color="#5b8def", linewidth=2)
    ax.plot(xs, accs, label="accuracy", color="#98c379", linewidth=2)
    ax.set_title(f"Snapshot @ step {step}")
    ax.set_xlabel("step")
    ax.legend(fontsize=8)
    fig.tight_layout()
    name = f"snapshot-step-{step}"
    run.log_figure(fig, name=name)
    plt.close(fig)
    return [f"{name}.png"]


def _print_integration_banner(st: IntegrationStatus) -> None:
    print("\n=== SDK integration probes ===", flush=True)
    print(f"  matplotlib (log_figure + sync): {'yes' if st.matplotlib else 'NO'}", flush=True)
    print(f"  matplotlib webp (pillow):         {'yes' if st.pillow else 'no'}", flush=True)
    print(f"  tensorboard write (SummaryWriter): {'yes' if st.tensorboard_write else 'NO'}", flush=True)
    print(f"  tensorboard read (tbparse sync):   {'yes' if st.tensorboard_read else 'NO'}", flush=True)
    print(f"  wandb (live + sync):             {'yes' if st.wandb else 'NO'}", flush=True)
    for note in st.notes:
        print(f"  note: {note}", flush=True)
    print("================================\n", flush=True)


def main() -> None:
    _disable_wandb_if_no_key()
    st = _probe_integrations()
    _print_integration_banner(st)

    name = _experiment_name()
    print(f"Creating experiment: {name}", flush=True)
    print(f"Updates every {STEP_SLEEP_SEC}s (max {MAX_STEPS} steps). Ctrl+C to stop early.", flush=True)

    tb_dir = Path(tempfile.mkdtemp(prefix="tt-tb-"))
    tb_writer = _open_tensorboard_writer(tb_dir) if st.tensorboard_write else None
    if tb_writer:
        print(f"TensorBoard logdir: {tb_dir}", flush=True)

    wandb_mod, wandb_path = _start_wandb_run(name)
    if wandb_mod and wandb_path:
        print(f"wandb run path: {wandb_path}", flush=True)
    elif st.wandb and not os.environ.get("WANDB_API_KEY", "").strip():
        print(
            "wandb: no WANDB_API_KEY — live wandb.log and exit sync skipped "
            "(demo wandb artifact link still added)",
            flush=True,
        )

    sync_on_exit: dict[str, str] = {}
    if st.tensorboard_read and tb_writer:
        sync_on_exit["tensorboard"] = str(tb_dir)
    if wandb_path:
        sync_on_exit["wandb"] = wandb_path

    losses: list[float] = []
    accs: list[float] = []
    exp_id: str | None = None

    try:
        with track(
            name,
            config={
                "source": "live_dummy_run.py",
                "integrations": {
                    "matplotlib": st.matplotlib,
                    "tensorboard": st.tensorboard_read and bool(tb_writer),
                    "wandb": bool(wandb_path),
                },
                "step_sec": STEP_SLEEP_SEC,
                "figure_every": FIGURE_EVERY,
                "model": "demo-resnet18",
                "batch_size": 64,
                "lr": 1e-3,
                "seed": 42,
            },
            hypothesis="Full SDK integration demo — direct logging + matplotlib + tensorboard + wandb sync",
            sync=sync_on_exit or None,
        ) as run:
            exp_id = run.id
            print(f"Experiment id: {run.id}", flush=True)
            print(f"Open: {_dashboard_url(run.id)}\n", flush=True)

            if st.matplotlib:
                uploaded = _upload_initial_gallery(run)
                print(f"  direct uploads: {', '.join(uploaded)}", flush=True)
                run.flush()

            for step in range(MAX_STEPS):
                loss = 0.9 * math.exp(-step / 40) + 0.08 + 0.03 * math.sin(step / 4)
                acc = min(0.995, 0.05 + step * 0.008 + 0.01 * math.sin(step / 6))
                f1 = min(0.99, acc * 0.92)
                lr = 1e-3 * (0.98 ** (step // 5))

                losses.append(round(loss, 4))
                accs.append(round(acc, 4))

                # --- direct SDK metrics ---
                run.log_metric("train_loss", losses[-1], step=step)
                run.log_metric("val_loss", round(loss * 1.08, 4), step=step)
                run.log_metric("accuracy", accs[-1], step=step)
                run.log_metric("f1", round(f1, 4), step=step)
                run.log_metric("learning_rate", round(lr, 6), step=step)

                # --- tensorboard writer (local event files) ---
                if tb_writer is not None:
                    tb_writer.add_scalar("tb/train_loss", loss, step)
                    tb_writer.add_scalar("tb/val_loss", loss * 1.08, step)
                    tb_writer.add_scalar("tb/accuracy", acc, step)
                    tb_writer.add_scalar("tb/f1", f1, step)
                    tb_writer.flush()

                # --- wandb live logging ---
                if wandb_mod is not None:
                    wandb_mod.log(
                        {
                            "wb/train_loss": loss,
                            "wb/val_loss": loss * 1.08,
                            "wb/accuracy": acc,
                            "wb/f1": f1,
                            "wb/lr": lr,
                        },
                        step=step,
                    )

                if st.matplotlib:
                    extra = _upload_step_figures(run, step, losses, accs)
                    if extra:
                        print(f"  figures: {', '.join(extra)}", flush=True)

                # Mid-run tensorboard sync (step 20) — tests run.sync_tensorboard()
                if step == 20 and st.tensorboard_read and tb_writer:
                    print("  syncing tensorboard logdir (mid-run)…", flush=True)
                    run.sync_tensorboard(str(tb_dir))

                run.flush()
                print(f"  step {step:3d}  loss={loss:.4f}  acc={acc:.4f}", flush=True)
                time.sleep(STEP_SLEEP_SEC)

            # --- matplotlib sync: sweep all open pyplot figures ---
            if st.matplotlib:
                print("  syncing open matplotlib figures (run.sync('matplotlib'))…", flush=True)
                _leave_matplotlib_figures_open()
                try:
                    run.sync("matplotlib", None)
                    run.flush()
                    print("  matplotlib sync done (check WebP/PNG artifacts on detail page)", flush=True)
                except Exception as exc:
                    print(f"  matplotlib sync failed: {exc}", flush=True)

            if sync_on_exit:
                print(f"  exit sync queued: {', '.join(sync_on_exit)}", flush=True)

        print(f"\nDone — experiment {exp_id} marked done.", flush=True)
        print("On the detail page expect:", flush=True)
        print("  · direct SDK curves (train_loss, accuracy, …)", flush=True)
        if tb_writer:
            print("  · tb/* curves from tensorboard sync", flush=True)
        if wandb_path:
            print("  · wb/* curves + wandb run link from wandb sync", flush=True)
        if st.matplotlib:
            print("  · log_figure PNGs + matplotlib-sync WebP/PNG grid", flush=True)
    finally:
        if tb_writer is not None:
            tb_writer.close()
        if wandb_mod is not None:
            import wandb

            wandb.finish()
        shutil.rmtree(tb_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
