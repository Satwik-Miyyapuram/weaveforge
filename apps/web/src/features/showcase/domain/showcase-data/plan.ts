/** Milestones with compute and dependencies, and the logbook. */

import type { ComputeNeed, MilestoneDependency } from "@weaveforge/core";

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
