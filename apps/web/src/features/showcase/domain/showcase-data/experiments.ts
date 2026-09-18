/** Experiments with metric curves and figures. */

import { SHOWCASE_TITLES as T } from "./papers";

export interface ShowcaseExperiment {
  name: string;
  hypothesis?: string;
  status: "planned" | "running" | "done" | "failed" | "abandoned";
  config: Record<string, unknown>;
  metrics: Record<string, number>;
  branch?: string;
  commit_sha?: string;
  repo_url?: string;
  run_command?: string;
  result_note?: string;
  related_paper?: string;
  startedDaysAgo?: number;
  finishedDaysAgo?: number;
  /** [chart kind, artifact file name] */
  artifacts?: [string, string][];
  /** Metric curves: name → [steps, value at step]. */
  curves?: Record<string, [number, (step: number) => number]>;
}

const decay = (a: number, tau: number, floor: number) => (s: number) => +(a * Math.exp(-s / tau) + floor).toFixed(4);
const rise = (start: number, per: number, cap: number) => (s: number) => +Math.min(cap, start + s * per).toFixed(4);

export const SHOWCASE_EXPERIMENTS: ShowcaseExperiment[] = [
  {
    name: "exp-01 β-VAE sweep — seed 42",
    hypothesis: "Higher β improves disentanglement at cost of reconstruction",
    status: "done",
    config: { beta: 4, lr: 1e-3, batch_size: 64, seed: 42, epochs: 30, dataset: "dsprites" },
    metrics: { val_loss: 0.1826, recon_loss: 0.0912, mig: 0.22, dci_d: 0.41 },
    branch: "main",
    commit_sha: "a1b2c3d4e5f6",
    repo_url: "https://github.com/example/thesis-code",
    run_command: "python train.py --model beta_vae --beta 4 --seed 42",
    result_note: "Matches Higgins et al. Fig. 6 within 2%. β=4 is the baseline for everything after this.",
    related_paper: T.betaVae,
    startedDaysAgo: 9,
    finishedDaysAgo: 8,
    artifacts: [
      ["beta-loss-curve", "train-loss.png"],
      ["beta-recon-grid", "recon-grid.png"],
      ["beta-sweep-bar", "beta-sweep.png"],
    ],
    curves: {
      train_loss: [30, decay(0.9, 12, 0.08)],
      recon_loss: [30, decay(0.5, 10, 0.09)],
      kl: [30, (s) => +(2.0 + 0.6 * Math.log1p(s)).toFixed(4)],
      mig: [30, rise(0.02, 0.0075, 0.23)],
    },
  },
  {
    name: "exp-02 ResNet-18 encoder baseline",
    hypothesis: "A pretrained ResNet-18 encoder reconstructs better than the 4-layer conv stack",
    status: "done",
    config: { model: "resnet18", epochs: 50, lr: 1e-3, decoder_bn: false },
    metrics: { accuracy: 0.912, val_loss: 0.34, recon_loss: 0.091 },
    branch: "main",
    commit_sha: "9f8e7d6c5b4a",
    run_command: "python train.py --encoder resnet18 --epochs 50",
    result_note: "Decoder BatchNorm removed after it hurt reconstruction (0.112 → 0.091).",
    related_paper: T.resnet,
    startedDaysAgo: 12,
    finishedDaysAgo: 11,
    artifacts: [
      ["resnet-accuracy", "val-accuracy.png"],
      ["resnet-training", "training-curves.png"],
    ],
    curves: {
      train_loss: [50, decay(1.4, 9, 0.3)],
      val_loss: [50, decay(1.5, 10, 0.34)],
      accuracy: [50, rise(0.1, 0.02, 0.912)],
    },
  },
  {
    name: "exp-03 Graph-prior v1 — seed 1",
    hypothesis: "A GIN encoder over the citation graph gives a prior that beats β=4 on MIG at equal reconstruction",
    status: "running",
    config: { graph_layers: 2, agg: "sum", beta: 4, seed: 1, epochs: 60 },
    metrics: { train_loss: 0.52, mig: 0.31 },
    branch: "feat/graph-prior",
    commit_sha: "0c1d2e3f4a5b",
    run_command: "python train.py --model graph_vae --layers 2 --agg sum --seed 1",
    related_paper: T.ours,
    startedDaysAgo: 1,
    artifacts: [
      ["graph-prior-loss", "train-loss.png"],
      ["graph-prior-structure", "graph-structure.png"],
    ],
    curves: {
      train_loss: [42, decay(1.1, 14, 0.5)],
      mig: [42, rise(0.03, 0.007, 0.31)],
    },
  },
  {
    name: "exp-04 Graph-prior v1 — seed 7",
    status: "running",
    config: { graph_layers: 2, agg: "sum", beta: 4, seed: 7, epochs: 60 },
    metrics: { train_loss: 0.61 },
    branch: "feat/graph-prior",
    commit_sha: "0c1d2e3f4a5b",
    run_command: "python train.py --model graph_vae --layers 2 --agg sum --seed 7",
    related_paper: T.ours,
    startedDaysAgo: 0,
    curves: {
      train_loss: [18, decay(1.1, 14, 0.5)],
      mig: [18, rise(0.03, 0.006, 0.31)],
    },
  },
  {
    name: "exp-05 IWAE bound, k=5",
    hypothesis: "The k=5 importance-weighted bound tightens held-out NLL by ≥ 2 nats",
    status: "done",
    config: { model: "beta_vae", beta: 1, k: 5, epochs: 30 },
    metrics: { nll: 98.4, elbo: 101.9 },
    branch: "main",
    commit_sha: "7a6b5c4d3e2f",
    result_note: "3.5 nats tighter. Reported in Table 3 only; not used for training.",
    related_paper: T.iwae,
    startedDaysAgo: 20,
    finishedDaysAgo: 19,
    curves: {
      nll: [30, decay(60, 6, 98.4)],
      elbo: [30, decay(62, 6, 101.9)],
    },
  },
  {
    name: "exp-06 Graph-prior, mean aggregation",
    hypothesis: "Mean aggregation matches sum on MIG",
    status: "failed",
    config: { graph_layers: 2, agg: "mean", beta: 4, seed: 1, epochs: 60 },
    metrics: { train_loss: 0.88, mig: 0.14 },
    branch: "feat/graph-prior",
    commit_sha: "b1c2d3e4f5a6",
    result_note: "Collapsed to the β=4 baseline — MIG 0.14. Consistent with GIN's expressiveness argument; mean throws away degree. Abandoned in favour of sum.",
    related_paper: T.gin,
    startedDaysAgo: 4,
    finishedDaysAgo: 3,
    curves: {
      train_loss: [60, decay(1.1, 20, 0.85)],
      mig: [60, rise(0.03, 0.002, 0.14)],
    },
  },
  {
    name: "exp-07 Ablation — graph depth {1,2,3,4}",
    hypothesis: "MIG peaks at 2–3 layers; deeper oversmooths",
    status: "planned",
    config: { graph_layers: [1, 2, 3, 4], agg: "sum", beta: 4, seeds: [1, 7, 13] },
    metrics: {},
    branch: "feat/graph-prior",
    related_paper: T.ours,
  },
  {
    name: "exp-08 Contrastive encoder init (SimCLR)",
    hypothesis: "SimCLR-initialised encoder converges in half the epochs",
    status: "abandoned",
    config: { encoder_init: "simclr", epochs: 30 },
    metrics: {},
    result_note: "Parked — the VAE line is ahead of schedule and this is not on the critical path.",
    related_paper: T.simclr,
  },
];
