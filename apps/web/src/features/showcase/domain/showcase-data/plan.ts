/** Milestones with compute and dependencies, and the logbook. */

export interface ShowcaseMilestone {
  title: string;
  description?: string;
  status: "planned" | "in_progress" | "done" | "blocked";
  target_date: string;
  dependencies?: unknown[];
  compute?: unknown[];
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
    title: "Thesis submission",
    status: "planned",
    target_date: "2026-09-30",
    dependencies: [{ kind: "milestone", label: "Ablation study" }],
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
  { daysAgo: 5, kind: "daily", body: "Added 36 papers to graph with 80+ typed edges. Concept tags (#vae, #gnn, #disentanglement) bridge clusters — toggle concepts in graph filters to explore." },
  { daysAgo: 6, kind: "daily", body: "Screening pass on the metrics review list: 12 titles, 8 through to full text. Two unsure — Locatello (evaluates but doesn't propose) and InfoGAN." },
  { daysAgo: 8, kind: "daily", body: "Decoder BatchNorm was hurting reconstruction (recon 0.112 → 0.091 without). Noted on exp-02 and in the BN paper." },
  { daysAgo: 10, kind: "weekly", body: "**Week 23** — ResNet-18 baseline done (91.2% val). β sweep launched. Drafted §2.1.1 VAE variants (520 words). Supervisor wants the impossibility argument moved up to §1.1." },
  { daysAgo: 12, kind: "daily", body: "Graph module useful for spotting missing citations: FactorVAE ↔ TC-VAE had no edge. Added it as `similar`." },
  { daysAgo: 15, kind: "daily", body: "MIG eval mismatch fixed — TC-VAE code uses 10k samples, mine used 2k. Numbers now agree to 0.01." },
  { daysAgo: 17, kind: "weekly", body: "**Week 22** — Reading week. Cleared the disentanglement cluster (TC-VAE, DIP-VAE, Eastwood). Vault page 'Metrics cheat-sheet' written." },
  { daysAgo: 21, kind: "daily", body: "Ethics resubmitted with amended consent form. Expect 3–4 weeks." },
  { daysAgo: 24, kind: "weekly", body: "**Week 21** — Lit review draft handed in (milestone done). Feedback: too much GAN, not enough on graph priors. Reordered reading lists accordingly." },
  { daysAgo: 30, kind: "daily", body: "dSprites loader done; 737k images fit in RAM as uint8. Sanity-checked factor counts against the README." },
];
