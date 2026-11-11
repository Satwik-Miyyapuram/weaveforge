import type { ComputeNeed, MilestoneDependency } from "@weaveforge/core";
import { SHOWCASE_TITLES as T, type ShowcaseAnnotation } from "./papers";

// --- annotations ---
/** Zotero-shaped annotations, the pins into report sections and quotation types. */
/**
 * Zotero-shaped PDF annotations, cached on `papers.metadata.annotations` — the
 * same place a real Zotero sync writes them. They drive the paper detail cards,
 * the graph side panel and the "Pinned annotations" rail beside a report
 * section (via annotation_pins).
 *
 * `annotationPosition` is a real Zotero position — zero-based `pageIndex` plus
 * PDF user-space rects. `page` is the display label and deliberately a string.
 */
export const SHOWCASE_ANNOTATIONS: Record<string, ShowcaseAnnotation[]> = {
  [T.attention]: [
    {
      key: "SHOWCASE-ATTN-1",
      kind: "annotation",
      annotationType: "highlight",
      text: "We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.",
      comment: "Core claim — cite in Ch. 2 when motivating the encoder baseline.",
      color: "#ffd400",
      page: "1",
      tags: ["transformers", "foundations"],
      annotationPosition: { pageIndex: 0, rects: [[100.2, 604.5, 495.8, 628.1]] },
      annotationSortIndex: "00000|000512|00604",
    },
    {
      key: "SHOWCASE-ATTN-2",
      kind: "annotation",
      annotationType: "highlight",
      text: "Self-attention, sometimes called intra-attention, is an attention mechanism relating different positions of a single sequence in order to compute a representation of the sequence.",
      comment: "Definition to paraphrase rather than quote directly.",
      color: "#a28ae5",
      page: "2",
      tags: ["transformers"],
      annotationPosition: { pageIndex: 1, rects: [[100.2, 322.4, 495.8, 358.9]] },
      annotationSortIndex: "00001|000318|00322",
    },
  ],
  [T.vae]: [
    {
      key: "SHOWCASE-VAE-1",
      kind: "annotation",
      annotationType: "highlight",
      text: "We introduce a stochastic variational inference and learning algorithm that scales to large datasets and, under some mild differentiability conditions, even works in the intractable case.",
      comment: "The reparameterisation trick — direct dependency for Ch. 3 method.",
      color: "#5fb236",
      page: "1",
      tags: ["vae", "latent-variables"],
      annotationPosition: { pageIndex: 0, rects: [[92.0, 566.3, 503.1, 601.7]] },
      annotationSortIndex: "00000|000476|00566",
    },
    {
      key: "SHOWCASE-VAE-2",
      kind: "note",
      annotationType: "note",
      comment:
        "Compare the ELBO formulation here against β-VAE's reweighting — the β sweep in exp-01 is the empirical version of this trade-off.",
      color: "#2ea8e5",
      page: "4",
      tags: ["vae", "disentanglement"],
      annotationPosition: { pageIndex: 3, rects: [[76.4, 445.0, 120.4, 461.0]] },
      annotationSortIndex: "00003|000221|00445",
    },
  ],
  [T.betaVae]: [
    {
      key: "SHOWCASE-BVAE-1",
      kind: "annotation",
      annotationType: "highlight",
      text: "We introduce β-VAE, a new state-of-the-art framework for automated discovery of interpretable factorised latent representations from raw image data in a completely unsupervised manner.",
      comment: "Motivates the β sweep. Summary-level use, not a direct quote.",
      color: "#ff6666",
      page: "1",
      tags: ["disentanglement", "vae"],
      annotationPosition: { pageIndex: 0, rects: [[105.6, 588.2, 490.4, 623.8]] },
      annotationSortIndex: "00000|000498|00588",
    },
  ],
  [T.locatello]: [
    {
      key: "SHOWCASE-LOC-1",
      kind: "annotation",
      annotationType: "highlight",
      text: "the unsupervised learning of disentangled representations is fundamentally impossible without inductive biases on both the models and the data.",
      comment: "The sentence the whole thesis hangs on. Quote directly in §1.1.",
      color: "#ff6666",
      page: "1",
      tags: ["disentanglement", "foundations"],
      annotationPosition: { pageIndex: 0, rects: [[88.0, 402.1, 508.2, 438.6]] },
      annotationSortIndex: "00000|000640|00402",
    },
    {
      key: "SHOWCASE-LOC-2",
      kind: "annotation",
      annotationType: "underline",
      text: "we observe that increased disentanglement does not seem to lead to a decreased sample complexity of learning for downstream tasks.",
      comment: "Counter-point for the limitations paragraph — do not oversell downstream benefit.",
      color: "#f19837",
      page: "8",
      tags: ["disentanglement", "evaluation"],
      annotationPosition: { pageIndex: 7, rects: [[88.0, 210.3, 508.2, 246.0]] },
      annotationSortIndex: "00007|000912|00210",
    },
  ],
  [T.tcvae]: [
    {
      key: "SHOWCASE-TC-1",
      kind: "annotation",
      annotationType: "highlight",
      text: "We decompose the evidence lower bound to show the existence of a term measuring the total correlation between latent variables.",
      comment: "Definition of TC — §2.1.2 uses this decomposition verbatim.",
      color: "#5fb236",
      page: "2",
      tags: ["disentanglement", "vae"],
      annotationPosition: { pageIndex: 1, rects: [[92.0, 501.0, 503.0, 524.4]] },
      annotationSortIndex: "00001|000288|00501",
    },
    {
      key: "SHOWCASE-TC-2",
      kind: "note",
      annotationType: "note",
      comment: "MIG is computed over 10k samples in their code. Match that in eval.py before comparing numbers.",
      color: "#2ea8e5",
      page: "6",
      tags: ["evaluation"],
      annotationPosition: { pageIndex: 5, rects: [[72.0, 330.0, 116.0, 346.0]] },
      annotationSortIndex: "00005|000404|00330",
    },
  ],
  [T.gin]: [
    {
      key: "SHOWCASE-GIN-1",
      kind: "annotation",
      annotationType: "highlight",
      text: "GNNs are at most as powerful as the WL test in distinguishing graph structures.",
      comment: "Upper bound on the graph-prior encoder. Cite when defending sum aggregation.",
      color: "#ffd400",
      page: "3",
      tags: ["gnn", "graph-prior"],
      annotationPosition: { pageIndex: 2, rects: [[96.0, 640.2, 500.0, 662.0]] },
      annotationSortIndex: "00002|000140|00640",
    },
  ],
};

/** [paperTitle, annotationKey, reportSectionNo] — pinned into the report rail. */
export const SHOWCASE_ANNOTATION_PINS: [string, string, string][] = [
  [T.attention, "SHOWCASE-ATTN-1", "2"],
  [T.vae, "SHOWCASE-VAE-1", "2"],
  [T.betaVae, "SHOWCASE-BVAE-1", "2"],
  [T.locatello, "SHOWCASE-LOC-1", "1.1"],
  [T.tcvae, "SHOWCASE-TC-1", "2.1.2"],
  [T.gin, "SHOWCASE-GIN-1", "3.2"],
];

/** [paperTitle, annotationKey, quotationType] */
export const SHOWCASE_QUOTATION_TYPES: [string, string, "direct" | "paraphrase" | "summary"][] = [
  [T.attention, "SHOWCASE-ATTN-1", "direct"],
  [T.attention, "SHOWCASE-ATTN-2", "paraphrase"],
  [T.betaVae, "SHOWCASE-BVAE-1", "summary"],
  [T.locatello, "SHOWCASE-LOC-1", "direct"],
  [T.locatello, "SHOWCASE-LOC-2", "paraphrase"],
  [T.tcvae, "SHOWCASE-TC-1", "paraphrase"],
  [T.gin, "SHOWCASE-GIN-1", "summary"],
];

// --- collab ---
/**
 * Supervision and sharing: what a supervisor says on the student's plan and
 * logbook, and how the student answers. Targets are milestone titles or
 * logbook `daysAgo` values from `plan.ts`.
 */
export interface ShowcaseCommentThread {
  resource: "milestone" | "log_entry";
  /** Milestone title, or the log entry's `daysAgo`. */
  target: string | number;
  /** The supervisor's opening comment. */
  body: string;
  /** The student's replies, in order. */
  replies: string[];
  /** Closed by the student after the replies. */
  resolved?: boolean;
}

export const SHOWCASE_SUPERVISOR_COMMENTS: ShowcaseCommentThread[] = [
  {
    resource: "milestone",
    target: "Graph-prior module v1",
    body: "Before calling this done I'd like to see the variance across the three seeds, not just the best one.",
    replies: ["Error bands added to the exp-03 chart; seed 13 is the weakest at MIG 0.26."],
  },
  {
    resource: "milestone",
    target: "Ablation study",
    body: "What happens to this if the cluster renewal is late? Is there a reduced version?",
    replies: ["Yes: depth {1, 3} × sum/mean only, one seed. Fits in the remaining allocation."],
  },
  {
    resource: "milestone",
    target: "Ethics approval (user study)",
    body: "If ethics is not through by the end of the month, drop §5 and keep it for the journal version.",
    replies: [],
  },
  {
    resource: "milestone",
    target: "Literature review draft",
    body: "Ch. 2 still leans on GANs. Cut that section by half and add the graph-prior papers.",
    replies: ["Done in the revision: GAN section is now one paragraph, graph priors have their own subsection."],
    resolved: true,
  },
  {
    resource: "log_entry",
    target: 0,
    body: "Good result. Keep the seed 7 checkpoint, we will want it for the traversal figure.",
    replies: ["Saved it to the run's artifacts and tagged it `traversal-fig`."],
  },
  {
    resource: "log_entry",
    target: 3,
    body: "Chase the ethics office again on Monday and copy me in.",
    replies: [],
  },
];

// --- experiments ---
/** Experiments with metric curves and figures. */
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

// --- plan ---
/** Milestones with compute and dependencies, and the logbook. */
export interface ShowcaseMilestone {
  title: string;
  description?: string;
  status: "planned" | "in_progress" | "done" | "blocked";
  target_date: string;
  dependencies?: MilestoneDependency[];
  compute?: ComputeNeed[];
}

export const SHOWCASE_MILESTONES: ShowcaseMilestone[] = [
  {
    title: "Proposal accepted",
    description: "Research proposal signed off by supervisor and second reader",
    status: "done",
    target_date: "2026-01-20",
  },
  {
    title: "Literature review draft",
    description: "Ch. 2 complete with 30+ papers mapped in graph",
    status: "done",
    target_date: "2026-03-15",
  },
  {
    title: "Data pipeline",
    description: "dSprites and 3D Shapes loaders with factor labels; deterministic splits",
    status: "done",
    target_date: "2026-04-10",
  },
  {
    title: "Baseline reproduction",
    description: "ResNet-18 + β-VAE baselines match published curves",
    status: "done",
    target_date: "2026-05-01",
    compute: [{ resource: "A100", count: 2, hours: 80, notes: "sweep β ∈ {1,2,4,8,16}" }],
  },
  {
    title: "Graph-prior module v1",
    description: "GIN encoder over the citation graph feeding the prior; MIG ≥ β-VAE on dSprites",
    status: "in_progress",
    target_date: "2026-07-10",
    dependencies: [{ kind: "milestone", label: "Baseline reproduction" }],
    compute: [{ resource: "A100", count: 4, hours: 160, notes: "3 seeds × 4 depths" }],
  },
  {
    title: "Ablation study",
    description: "Graph depth, aggregation, edge types; DCI + MIG with 95% CIs",
    status: "planned",
    target_date: "2026-08-05",
    dependencies: [
      { kind: "milestone", label: "Graph-prior module v1" },
      { kind: "external", label: "Cluster allocation renewal" },
    ],
    compute: [{ resource: "A100", count: 4, hours: 240 }],
  },
  {
    title: "Ethics approval (user study)",
    description: "Blocked on departmental ethics board — resubmitted with amended consent form",
    status: "blocked",
    target_date: "2026-07-01",
    dependencies: [{ kind: "external", label: "Ethics board decision" }],
  },
  {
    title: "Workshop paper",
    description: "4-page submission to a NeurIPS workshop",
    status: "planned",
    target_date: "2026-08-22",
    dependencies: [{ kind: "milestone", label: "Ablation study" }],
  },
  {
    title: "Mid-term review",
    description: "Progress talk to the committee; go/no-go on the graph prior",
    status: "done",
    target_date: "2026-06-20",
  },
  {
    title: "Thesis submission",
    status: "planned",
    target_date: "2026-09-30",
    dependencies: [{ kind: "milestone", label: "Ablation study" }],
  },
  {
    title: "Thesis defence",
    description: "30-minute talk and questions; slides reuse the workshop figures",
    status: "planned",
    target_date: "2026-12-15",
    dependencies: [{ kind: "milestone", label: "Thesis submission" }],
  },
  {
    title: "Journal extension draft",
    description: "Extend to 3D Shapes and a downstream task for a TMLR submission",
    status: "planned",
    target_date: "2027-02-28",
    dependencies: [{ kind: "milestone", label: "Thesis defence" }],
  },
];

export interface ShowcaseLogEntry {
  daysAgo: number;
  kind: "daily" | "weekly";
  body: string;
}

export const SHOWCASE_LOG: ShowcaseLogEntry[] = [
  { daysAgo: 0, kind: "daily", body: "Graph-prior run (exp-03) hit MIG 0.31 at epoch 40 — first time above the β=4 baseline. Leaving seed 7 running overnight." },
  { daysAgo: 1, kind: "daily", body: "Read GIN properly. Sum aggregation it is; mean was throwing away degree information the citation graph actually carries. Swapped in `graph.agg = \"sum\"`." },
  { daysAgo: 2, kind: "daily", body: "Finished β-VAE reproduction — loss curves match Higgins et al. within 2%. Next: wire SDK live logging." },
  { daysAgo: 3, kind: "weekly", body: "**Week 24** — Baselines closed out. Graph-prior v1 is training; two of three seeds look good. Ethics still blocked, chased the office again. Reading: GIN, DGI." },
  { daysAgo: 4, kind: "daily", body: "Wrote the ablation config grid: depth {1,2,3,4} × aggregation {sum, mean, max} × edge types {cites, all}. 24 runs × 3 seeds." },
  { daysAgo: 5, kind: "daily", body: "Added 36 papers to graph with 80+ typed edges. Concept tags (#vae, #gnn, #disentanglement) bridge clusters — toggle concepts in graph filters to explore." },
  { daysAgo: 6, kind: "daily", body: "Screening pass on the metrics review list: 12 titles, 8 through to full text. Two unsure — Locatello (evaluates but doesn't propose) and InfoGAN." },
  { daysAgo: 7, kind: "daily", body: "Supervisor meeting. Agreed the workshop paper reports dSprites only; 3D Shapes goes to the journal extension." },
  { daysAgo: 8, kind: "daily", body: "Decoder BatchNorm was hurting reconstruction (recon 0.112 → 0.091 without). Noted on exp-02 and in the BN paper." },
  { daysAgo: 9, kind: "daily", body: "**Debugging the KL collapse in exp-04**\n\nSpent the whole day on this. Symptoms: from epoch 12 the KL term drops to ~0.02 nats and stays there, reconstruction keeps improving, MIG falls from 0.24 to 0.05. Classic posterior collapse, but only with the graph prior switched on — the β=4 baseline with the same seed is fine.\n\nWhat I ruled out, in order:\n\n1. Learning rate. Halved it (1e-3 → 5e-4): collapse moves to epoch 19, does not go away.\n2. KL warm-up. Linear warm-up over 10 epochs: same thing, just later.\n3. The decoder being too strong. Swapped the 4-layer deconv for the 2-layer one from the baseline: still collapses.\n4. Data. Re-ran the factor-count sanity check on the loader; splits are deterministic and identical to exp-02.\n\nWhat it was: the prior's variance head. The GIN readout feeds a softplus for σ, and with sum aggregation the pre-activation grows with node degree. High-degree concept nodes (`#vae`, `#disentanglement`) end up with σ in the hundreds, so the prior is nearly flat and the KL to it is tiny whatever the posterior does. The optimiser happily takes the free lunch.\n\nFix: divide the readout by √degree before the softplus (the same normalisation GCN uses), and clamp log σ to [−5, 2]. Re-ran seed 7 for 20 epochs: KL settles at 9.8 nats, MIG 0.27 and climbing. Seeds 1 and 13 queued overnight.\n\nLessons for the conventions page: log the prior's mean σ every epoch, not just the KL; a flat prior hides behind a healthy-looking loss curve. Also worth a sentence in §3.2 — anyone using sum aggregation in a prior network will hit this.\n\nOpen question for the supervisor meeting: is the √degree normalisation a change to the method (needs an ablation row) or an implementation detail (footnote)? Leaning towards the ablation row, it is cheap." },
  { daysAgo: 10, kind: "weekly", body: "**Week 23** — ResNet-18 baseline done (91.2% val). β sweep launched. Drafted §2.1.1 VAE variants (520 words). Supervisor wants the impossibility argument moved up to §1.1." },
  { daysAgo: 11, kind: "daily", body: "Recon grids for exp-03 look sharper than the baseline at the same KL. Saved `recon-grid.png` on the run." },
  { daysAgo: 12, kind: "daily", body: "Graph module useful for spotting missing citations: FactorVAE ↔ TC-VAE had no edge. Added it as `similar`." },
  { daysAgo: 13, kind: "daily", body: "Read Burgess et al. on capacity annealing. Explains why β=4 works on dSprites and β=16 over-regularises." },
  { daysAgo: 14, kind: "daily", body: "Cluster maintenance all day. Used the time to tidy the reading lists and tag the GNN papers." },
  { daysAgo: 15, kind: "daily", body: "MIG eval mismatch fixed — TC-VAE code uses 10k samples, mine used 2k. Numbers now agree to 0.01." },
  { daysAgo: 16, kind: "daily", body: "DCI implementation checked against the reference code — matches to three decimals on the β-VAE checkpoint." },
  { daysAgo: 17, kind: "weekly", body: "**Week 22** — Reading week. Cleared the disentanglement cluster (TC-VAE, DIP-VAE, Eastwood). Vault page 'Metrics cheat-sheet' written." },
  { daysAgo: 19, kind: "daily", body: "Drafted §3.1 (problem statement), 640 words. The notation page saved an hour." },
  { daysAgo: 21, kind: "daily", body: "Ethics resubmitted with amended consent form. Expect 3–4 weeks." },
  { daysAgo: 22, kind: "daily", body: "Second reader replied: happy with the scope, wants one paragraph on compute cost." },
  { daysAgo: 24, kind: "weekly", body: "**Week 21** — Lit review draft handed in (milestone done). Feedback: too much GAN, not enough on graph priors. Reordered reading lists accordingly." },
  { daysAgo: 26, kind: "daily", body: "Baseline β sweep finished. β=4 best MIG; β=16 collapses two of five latents." },
  { daysAgo: 28, kind: "daily", body: "Ported the eval scripts into the SDK so every run logs MIG and DCI per epoch." },
  { daysAgo: 30, kind: "daily", body: "dSprites loader done; 737k images fit in RAM as uint8. Sanity-checked factor counts against the README." },
  { daysAgo: 31, kind: "weekly", body: "**Week 20** — Lit review revisions in. Started the graph-prior design doc. Cluster renewal form sent." },
  { daysAgo: 35, kind: "daily", body: "First end-to-end run of the graph prior on a toy graph (8 nodes). Trains, numbers meaningless, plumbing works." },
  { daysAgo: 38, kind: "weekly", body: "**Week 19** — Mostly reading: GIN, GraphSAGE, DGI. Decided against attention in the prior for now." },
  { daysAgo: 44, kind: "daily", body: "Read the impossibility paper again for the intro. The argument is cleaner than I remembered." },
  { daysAgo: 45, kind: "weekly", body: "**Week 18** — Data pipeline milestone closed. 3D Shapes loader works but is slow; parked." },
  { daysAgo: 52, kind: "weekly", body: "**Week 17** — Mid-term prep: slides drafted, dry run with the lab on Thursday." },
  { daysAgo: 59, kind: "weekly", body: "**Week 16** — Kick-off of the experiments phase. Set up the cluster account and the experiment conventions." },
];

// --- reading ---
/** Reading lists, one of them a systematic-review screen. */
export interface ShowcaseReadingList {
  name: string;
  description?: string;
  color: string;
  parent?: string;
  papers: string[];
  /** Per-paper note, keyed by title. */
  notes?: Record<string, string>;
}

/** The systematic-review list; screening decisions name it too. */
const SR = "Systematic review — disentanglement metrics";

export const SHOWCASE_READING_LISTS: ShowcaseReadingList[] = [
  {
    name: "Thesis foundations",
    description: "Core concepts & baselines",
    color: "#5b8def",
    papers: [T.attention, T.resnet, T.battaglia, T.adam, T.batchnorm],
    notes: { [T.adam]: "Defaults everywhere. Do not re-tune." },
  },
  {
    name: "Related work — generative models",
    color: "#98c379",
    papers: [T.flows, T.vaeSurvey],
  },
  {
    name: "VAE & disentanglement",
    parent: "Related work — generative models",
    color: "#7c9885",
    papers: [T.vae, T.betaVae, T.factorVae, T.tcvae, T.dipVae, T.locatello, T.iwae, T.cvae, T.ladder],
    notes: {
      [T.tcvae]: "Re-read §3 before writing 2.1.2.",
      [T.locatello]: "Quote the impossibility theorem exactly.",
    },
  },
  {
    name: "Diffusion & adversarial",
    parent: "Related work — generative models",
    color: "#9a7bb0",
    papers: [T.vqVae, T.ddpm, T.sde, T.gan, T.infogan],
  },
  {
    name: "Graph & relational models",
    description: "GNN encoders and graph priors",
    color: "#c98a6b",
    papers: [T.gnnSurvey],
  },
  {
    name: "GNN architectures",
    parent: "Graph & relational models",
    color: "#5a7d8c",
    papers: [T.gcn, T.gat, T.graphsage, T.gin, T.dgi],
  },
  {
    name: "Graph–VAE hybrids",
    parent: "Graph & relational models",
    color: "#c98a6b",
    papers: [T.vgae, T.nri, T.ours],
  },
  {
    name: "Evaluation & data",
    color: "#d19a66",
    papers: [T.dsprites, T.eastwood, T.tcvae],
  },
  {
    name: "Encoder pre-training (parked)",
    description: "Contrastive init — only if the VAE line stalls",
    color: "#8a8f98",
    papers: [T.simclr, T.moco, T.byol, T.dgi],
  },
  {
    name: SR,
    description: "Screening for the survey table in Ch. 2. Inclusion: proposes or evaluates a metric on dSprites.",
    color: "#c75c5c",
    papers: [T.betaVae, T.factorVae, T.tcvae, T.dipVae, T.eastwood, T.locatello, T.infogan, T.vqVae, T.iwae, T.ladder, T.dsprites, T.cvae],
  },
];

export interface ShowcaseScreeningDecision {
  list: string;
  paper: string;
  stage: "title_abstract" | "full_text";
  state: "included" | "excluded" | "unsure";
  reason?: string;
}

export const SHOWCASE_SCREENING: ShowcaseScreeningDecision[] = [
  { list: SR, paper: T.betaVae, stage: "title_abstract", state: "included" },
  { list: SR, paper: T.betaVae, stage: "full_text", state: "included", reason: "Proposes the β-VAE metric" },
  { list: SR, paper: T.factorVae, stage: "title_abstract", state: "included" },
  { list: SR, paper: T.factorVae, stage: "full_text", state: "included", reason: "FactorVAE metric on dSprites" },
  { list: SR, paper: T.tcvae, stage: "title_abstract", state: "included" },
  { list: SR, paper: T.tcvae, stage: "full_text", state: "included", reason: "MIG" },
  { list: SR, paper: T.dipVae, stage: "title_abstract", state: "included" },
  { list: SR, paper: T.dipVae, stage: "full_text", state: "included", reason: "SAP score" },
  { list: SR, paper: T.eastwood, stage: "title_abstract", state: "included" },
  { list: SR, paper: T.eastwood, stage: "full_text", state: "included", reason: "DCI" },
  { list: SR, paper: T.locatello, stage: "title_abstract", state: "included" },
  { list: SR, paper: T.locatello, stage: "full_text", state: "unsure", reason: "Evaluates metrics but proposes none" },
  { list: SR, paper: T.infogan, stage: "title_abstract", state: "unsure" },
  { list: SR, paper: T.vqVae, stage: "title_abstract", state: "excluded", reason: "No disentanglement metric" },
  { list: SR, paper: T.iwae, stage: "title_abstract", state: "excluded", reason: "Likelihood only" },
  { list: SR, paper: T.ladder, stage: "title_abstract", state: "excluded", reason: "Not evaluated on dSprites" },
  { list: SR, paper: T.dsprites, stage: "title_abstract", state: "included" },
  { list: SR, paper: T.dsprites, stage: "full_text", state: "excluded", reason: "Dataset, not a metric" },
  { list: SR, paper: T.cvae, stage: "title_abstract", state: "excluded", reason: "Off topic" },
];
