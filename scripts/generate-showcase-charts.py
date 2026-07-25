#!/usr/bin/env python3
"""Generate PNG charts for showcase seed data.

Writes files to scripts/assets/showcase/ (or --out-dir). Safe to re-run.

    python scripts/generate-showcase-charts.py
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

ROOT = Path(__file__).resolve().parent
DEFAULT_OUT = ROOT / "assets" / "showcase"

PALETTE = {
    "ink": "#2c3e50",
    "accent": "#3b5b8c",
    "accent2": "#5b8def",
    "muted": "#8a9bb0",
    "grid": "#e8ecf2",
}


def _save(fig: plt.Figure, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, format="png", dpi=120, bbox_inches="tight", facecolor="white")
    plt.close(fig)


def attention_arch(path: Path) -> None:
    fig, ax = plt.subplots(figsize=(6.5, 3.2))
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 4)
    ax.axis("off")
    boxes = [
        (0.4, 1.6, "Input\nembeddings"),
        (2.2, 1.6, "Multi-head\nself-attention"),
        (4.4, 1.6, "Add & norm"),
        (6.2, 1.6, "Feed-forward"),
        (8.0, 1.6, "Output"),
    ]
    for x, y, label in boxes:
        ax.add_patch(plt.Rectangle((x, y), 1.4, 1.0, fc="#eef3fb", ec=PALETTE["accent"], lw=1.5))
        ax.text(x + 0.7, y + 0.5, label, ha="center", va="center", fontsize=8, color=PALETTE["ink"])
    for i in range(len(boxes) - 1):
        x0 = boxes[i][0] + 1.4
        x1 = boxes[i + 1][0]
        ax.annotate("", xy=(x1, 2.1), xytext=(x0, 2.1), arrowprops=dict(arrowstyle="->", color=PALETTE["muted"]))
    ax.set_title("Transformer encoder block (schematic)", fontsize=10, color=PALETTE["ink"])
    _save(fig, path)


def resnet_block(path: Path) -> None:
    fig, ax = plt.subplots(figsize=(5.5, 3.5))
    ax.set_xlim(0, 8)
    ax.set_ylim(0, 5)
    ax.axis("off")
    ax.add_patch(plt.Rectangle((0.5, 2.0), 1.2, 1.0, fc="#eef3fb", ec=PALETTE["accent"]))
    ax.text(1.1, 2.5, "conv", ha="center", va="center", fontsize=9)
    ax.add_patch(plt.Rectangle((2.2, 2.0), 1.2, 1.0, fc="#eef3fb", ec=PALETTE["accent"]))
    ax.text(2.8, 2.5, "conv", ha="center", va="center", fontsize=9)
    ax.annotate("", xy=(2.2, 2.5), xytext=(1.7, 2.5), arrowprops=dict(arrowstyle="->", color=PALETTE["muted"]))
    ax.annotate("", xy=(4.0, 2.5), xytext=(3.4, 2.5), arrowprops=dict(arrowstyle="->", color=PALETTE["muted"]))
    ax.plot([4.2, 6.8], [2.5, 2.5], color=PALETTE["accent2"], lw=2)
    ax.plot([4.2, 4.2], [3.8, 2.5], color=PALETTE["accent2"], lw=2, linestyle="--")
    ax.text(5.5, 3.2, "skip", ha="center", fontsize=8, color=PALETTE["accent2"])
    ax.add_patch(plt.Circle((6.8, 2.5), 0.18, fc=PALETTE["accent"], ec=PALETTE["accent"]))
    ax.text(6.8, 2.5, "+", ha="center", va="center", color="white", fontsize=10, fontweight="bold")
    ax.set_title("Residual block", fontsize=10, color=PALETTE["ink"])
    _save(fig, path)


def beta_vae_heatmap(path: Path) -> None:
    rng = np.random.default_rng(7)
    z = rng.normal(size=(6, 6))
    fig, ax = plt.subplots(figsize=(4.5, 4))
    im = ax.imshow(z, cmap="RdBu_r", vmin=-2, vmax=2)
    ax.set_xticks(range(6))
    ax.set_yticks(range(6))
    ax.set_xlabel("latent dim")
    ax.set_ylabel("factor")
    ax.set_title("β-VAE latent traversals (synthetic)")
    fig.colorbar(im, ax=ax, fraction=0.046)
    _save(fig, path)


def vqvae_codebook(path: Path) -> None:
    rng = np.random.default_rng(3)
    codes = rng.uniform(0, 1, size=(12, 3))
    fig, ax = plt.subplots(figsize=(5, 3.5))
    for i, c in enumerate(codes):
        ax.add_patch(plt.Rectangle((i % 6, i // 6), 0.85, 0.85, fc=c, ec="white", lw=1))
    ax.set_xlim(0, 6)
    ax.set_ylim(0, 2)
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_title("VQ codebook entries (illustrative)")
    _save(fig, path)


def gnn_graph(path: Path) -> None:
    fig, ax = plt.subplots(figsize=(5, 4))
    nodes = {"A": (0.2, 0.7), "B": (0.5, 0.85), "C": (0.8, 0.7), "D": (0.35, 0.35), "E": (0.65, 0.35)}
    edges = [("A", "B"), ("B", "C"), ("A", "D"), ("C", "E"), ("D", "E"), ("B", "D")]
    for a, b in edges:
        xa, ya = nodes[a]
        xb, yb = nodes[b]
        ax.plot([xa, xb], [ya, yb], color=PALETTE["muted"], lw=1.5, zorder=1)
    for name, (x, y) in nodes.items():
        ax.scatter([x], [y], s=420, c=PALETTE["accent2"], zorder=2)
        ax.text(x, y, name, ha="center", va="center", color="white", fontsize=9, fontweight="bold", zorder=3)
    ax.set_xlim(0, 1)
    ax.set_ylim(0.2, 1)
    ax.axis("off")
    ax.set_title("Knowledge-graph neighbourhood", fontsize=10, color=PALETTE["ink"])
    _save(fig, path)


def method_overview(path: Path) -> None:
    fig, ax = plt.subplots(figsize=(6.5, 3.5))
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 4)
    ax.axis("off")
    stages = [
        (0.3, "Encoder\n(β-VAE)"),
        (2.5, "Graph\nprior"),
        (4.7, "Decoder"),
        (7.0, "Downstream\ntask"),
    ]
    for x, label in stages:
        ax.add_patch(plt.Rectangle((x, 1.5), 1.6, 1.2, fc="#eef3fb", ec=PALETTE["accent"], lw=1.5))
        ax.text(x + 0.8, 2.1, label, ha="center", va="center", fontsize=8)
    for i in range(len(stages) - 1):
        x0 = stages[i][0] + 1.6
        x1 = stages[i + 1][0]
        ax.annotate("", xy=(x1, 2.1), xytext=(x0, 2.1), arrowprops=dict(arrowstyle="->", color=PALETTE["muted"]))
    ax.set_title("Proposed pipeline (draft)", fontsize=10, color=PALETTE["ink"])
    _save(fig, path)


def loss_curve(path: Path, title: str, color: str) -> None:
    steps = np.arange(0, 40)
    y = 0.9 * np.exp(-steps / 12) + 0.08 + 0.02 * np.sin(steps / 3)
    fig, ax = plt.subplots(figsize=(5.5, 3.2))
    ax.plot(steps, y, color=color, lw=2)
    ax.set_xlabel("step")
    ax.set_ylabel("loss")
    ax.set_title(title)
    ax.grid(True, color=PALETTE["grid"])
    _save(fig, path)


def beta_sweep_bar(path: Path) -> None:
    betas = [2, 4, 6, 8]
    recon = [0.12, 0.09, 0.11, 0.15]
    disent = [0.42, 0.58, 0.64, 0.71]
    x = np.arange(len(betas))
    w = 0.35
    fig, ax = plt.subplots(figsize=(5.5, 3.2))
    ax.bar(x - w / 2, recon, w, label="recon loss", color=PALETTE["accent2"])
    ax.bar(x + w / 2, disent, w, label="disentanglement", color=PALETTE["accent"])
    ax.set_xticks(x)
    ax.set_xticklabels([f"β={b}" for b in betas])
    ax.legend(frameon=False, fontsize=8)
    ax.set_title("β sweep summary")
    ax.grid(axis="y", color=PALETTE["grid"])
    _save(fig, path)


def recon_grid(path: Path) -> None:
    rng = np.random.default_rng(11)
    fig, axes = plt.subplots(2, 3, figsize=(5.5, 3.5))
    for ax in axes.flat:
        ax.imshow(rng.uniform(0, 1, (16, 16, 3)))
        ax.set_xticks([])
        ax.set_yticks([])
    fig.suptitle("Reconstructions (synthetic grid)", fontsize=10, color=PALETTE["ink"])
    fig.tight_layout()
    _save(fig, path)


def accuracy_curve(path: Path) -> None:
    epochs = np.arange(1, 51)
    acc = 1 - 0.55 * np.exp(-epochs / 15) + 0.01 * np.random.default_rng(5).normal(size=len(epochs))
    fig, ax = plt.subplots(figsize=(5.5, 3.2))
    ax.plot(epochs, acc, color=PALETTE["accent"], lw=2)
    ax.set_xlabel("epoch")
    ax.set_ylabel("val accuracy")
    ax.set_ylim(0.5, 1.0)
    ax.set_title("ResNet-18 validation accuracy")
    ax.grid(True, color=PALETTE["grid"])
    _save(fig, path)


def training_curves(path: Path) -> None:
    epochs = np.arange(1, 51)
    train = 0.5 * np.exp(-epochs / 20) + 0.05
    val = train + 0.08
    fig, ax = plt.subplots(figsize=(5.5, 3.2))
    ax.plot(epochs, train, label="train", color=PALETTE["accent2"])
    ax.plot(epochs, val, label="val", color=PALETTE["accent"])
    ax.legend(frameon=False)
    ax.set_xlabel("epoch")
    ax.set_ylabel("loss")
    ax.set_title("ResNet-18 training curves")
    ax.grid(True, color=PALETTE["grid"])
    _save(fig, path)


def graph_prior_structure(path: Path) -> None:
    fig, ax = plt.subplots(figsize=(5, 3.5))
    layers = [("Concepts", 0.15), ("GNN L1", 0.45), ("GNN L2", 0.75)]
    for label, x in layers:
        ax.add_patch(plt.Rectangle((x, 0.35), 0.22, 0.5, fc="#eef3fb", ec=PALETTE["accent"]))
        ax.text(x + 0.11, 0.6, label, ha="center", va="center", fontsize=8, rotation=90)
        if x < 0.75:
            ax.annotate("", xy=(x + 0.28, 0.6), xytext=(x + 0.22, 0.6),
                        arrowprops=dict(arrowstyle="->", color=PALETTE["muted"]))
    ax.set_xlim(0, 1)
    ax.set_ylim(0.2, 1)
    ax.axis("off")
    ax.set_title("Graph-prior depth ablation", fontsize=10, color=PALETTE["ink"])
    _save(fig, path)


CHARTS: dict[str, callable] = {
    "attention-arch": attention_arch,
    "resnet-block": resnet_block,
    "beta-vae-heatmap": beta_vae_heatmap,
    "vqvae-codebook": vqvae_codebook,
    "gnn-graph": gnn_graph,
    "method-overview": method_overview,
    "beta-loss-curve": lambda p: loss_curve(p, "β-VAE train loss", PALETTE["accent"]),
    "beta-recon-grid": recon_grid,
    "beta-sweep-bar": beta_sweep_bar,
    "resnet-accuracy": accuracy_curve,
    "resnet-training": training_curves,
    "graph-prior-loss": lambda p: loss_curve(p, "Graph-prior train loss (running)", PALETTE["accent2"]),
    "graph-prior-structure": graph_prior_structure,
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--only", nargs="*", help="Generate subset of chart ids")
    args = parser.parse_args()
    out_dir: Path = args.out_dir
    names = args.only if args.only else sorted(CHARTS.keys())
    for name in names:
        if name not in CHARTS:
            raise SystemExit(f"Unknown chart: {name}")
        dest = out_dir / f"{name}.png"
        CHARTS[name](dest)
        print(f"  {dest.relative_to(ROOT.parent)}")
    print(f"Wrote {len(names)} chart(s) to {out_dir}")


if __name__ == "__main__":
    main()
