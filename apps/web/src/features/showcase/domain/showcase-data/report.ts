/** Report outline, vault notes, custom fields, citation alerts, pins and the supervisee. */

import { SHOWCASE_TITLES as T } from "./papers";
import type { ShowcaseLogEntry, ShowcaseMilestone } from "./plan";

export interface ShowcaseReportSection {
  section_no: string;
  title: string;
  parent?: string;
  status: "not_started" | "drafting" | "review" | "done";
  word_count?: number;
  target_words?: number;
  deadline?: string;
  notes?: string;
}

export const SHOWCASE_REPORT: ShowcaseReportSection[] = [
  { section_no: "1", title: "Introduction", status: "drafting", word_count: 1200, target_words: 2500, deadline: "2026-08-15" },
  { section_no: "1.1", parent: "1", title: "Problem statement", status: "review", word_count: 780, target_words: 900, notes: "Supervisor: open with the Locatello impossibility result." },
  { section_no: "1.2", parent: "1", title: "Contributions", status: "drafting", word_count: 400, target_words: 800 },
  { section_no: "1.3", parent: "1", title: "Thesis outline", status: "not_started", target_words: 300 },
  { section_no: "2", title: "Background", status: "drafting", word_count: 3400, target_words: 4500, deadline: "2026-08-01" },
  { section_no: "2.1", parent: "2", title: "Generative models", status: "drafting", word_count: 1800, target_words: 2200 },
  { section_no: "2.1.1", parent: "2.1", title: "VAE variants", status: "done", word_count: 920, target_words: 900 },
  { section_no: "2.1.2", parent: "2.1", title: "Disentanglement literature", status: "drafting", word_count: 640, target_words: 900, notes: "Table 2: β-VAE / FactorVAE / TC-VAE / DIP-VAE on one axis." },
  { section_no: "2.1.3", parent: "2.1", title: "Other generative families", status: "not_started", target_words: 400, notes: "GAN, diffusion, flows — one paragraph each." },
  { section_no: "2.2", parent: "2", title: "Graph neural networks", status: "drafting", word_count: 1100, target_words: 1800 },
  { section_no: "2.3", parent: "2", title: "Disentanglement metrics", status: "drafting", word_count: 500, target_words: 700, notes: "From the systematic review list." },
  { section_no: "3", title: "Method", status: "drafting", word_count: 1500, target_words: 5000, deadline: "2026-08-25" },
  { section_no: "3.1", parent: "3", title: "Encoder architecture", status: "drafting", word_count: 900, target_words: 2200 },
  { section_no: "3.2", parent: "3", title: "Graph-prior module", status: "drafting", word_count: 600, target_words: 2400, notes: "Justify sum aggregation via GIN." },
  { section_no: "3.3", parent: "3", title: "Training objective", status: "not_started", target_words: 800 },
  { section_no: "4", title: "Experiments", status: "not_started", target_words: 4000, deadline: "2026-09-05" },
  { section_no: "4.1", parent: "4", title: "Setup", status: "not_started", target_words: 800 },
  { section_no: "4.2", parent: "4", title: "Baselines", status: "not_started", target_words: 1000 },
  { section_no: "4.3", parent: "4", title: "Ablations", status: "not_started", target_words: 1500 },
  { section_no: "5", title: "Discussion", status: "not_started", target_words: 2000, deadline: "2026-09-15" },
  { section_no: "6", title: "Conclusion", status: "not_started", target_words: 1500, deadline: "2026-09-20" },
];

export interface ShowcaseVaultPage {
  title: string;
  body: string;
}

export const SHOWCASE_VAULT: ShowcaseVaultPage[] = [
  {
    title: "Core concepts",
    body: "## Latent variable models #vae #elbo #latent-variables\n\n- **ELBO** — trade-off between reconstruction and KL\n- **β-VAE** — scale KL term for disentanglement\n- **FactorVAE** — total-correlation penalty variant\n- **TC-VAE** — decomposes the KL into MI + TC + dim-wise KL\n\n## Graph prior #gnn #graph-prior\n\nNodes = concepts, edges = citations or dependencies. See VGAE + GAT + GIN papers in the graph.\n\n```mermaid\nflowchart LR\n  X[image] --> E[ResNet-18 encoder] --> Q[q(z|x)]\n  G[citation graph] --> P[GIN prior p(z|G)]\n  Q --> KL{KL}\n  P --> KL\n  Q --> D[decoder] --> R[reconstruction]\n```",
  },
  {
    title: "Disentanglement reading cluster",
    body: "Papers to compare in the graph view:\n\n- β-VAE, FactorVAE, TC-VAE, DIP-VAE, InfoGAN, Locatello impossibility result\n- Our graph prior as an explicit inductive bias #disentanglement #vae\n\nOpen graph → enable **concepts** + **co-occurrence** for tag bridges.\n\n[[Metrics cheat-sheet]] has the numbers to report.",
  },
  {
    title: "Metrics cheat-sheet",
    body: "# Disentanglement metrics #evaluation #disentanglement\n\n| Metric | Paper | Range | Samples |\n|---|---|---|---|\n| β-VAE score | Higgins 2017 | 0–1 | 10k |\n| FactorVAE score | Kim & Mnih 2018 | 0–1 | 10k |\n| **MIG** | Chen 2018 (TC-VAE) | 0–1 | 10k |\n| SAP | Kumar 2018 (DIP-VAE) | 0–1 | 10k |\n| **DCI** | Eastwood & Williams 2018 | 0–1 | 10k |\n\nReport MIG + DCI-D everywhere; the rest go in the appendix.\n\n> TC-VAE code uses 10k samples for MIG. Match it. (Fixed in eval.py, week 22.)",
  },
  {
    title: "Contrastive encoder baselines",
    body: "Optional ResNet init from #contrastive #self-supervised runs (SimCLR, MoCo, BYOL). Lower priority than VAE line — see exp-08 (abandoned). #representation-learning",
  },
  {
    title: "Meeting notes — supervisor",
    body: "## 2026-06-12\n- Focus ablation on β and graph depth #disentanglement #graph-prior\n- Move the impossibility argument up to §1.1\n- Target NeurIPS workshop deadline\n\n## 2026-05-29\n- Lit review feedback: too much GAN, not enough graph priors\n- Share compare view link next sync\n\n## 2026-05-15\n- Baselines look right; start graph-prior v1",
  },
  {
    title: "Experiment conventions",
    body: "# Conventions #experiments\n\n- Names: `exp-NN <what> — seed S`\n- Every run logs `train_loss`, `recon_loss`, `kl`, `mig` per epoch through the SDK\n- Seeds: 1, 7, 13. Seed 42 only for reproductions.\n- Artifacts: `train-loss.png`, `recon-grid.png` minimum\n- Optimiser: Adam, lr 1e-3, no schedule. See [[Core concepts]].",
  },
  {
    title: "Thesis argument (one page)",
    body: "# The argument #thesis\n\n1. Unsupervised disentanglement is impossible without inductive bias (Locatello 2019).\n2. β-VAE-family methods smuggle the bias in through the objective; it is weak and dataset-specific.\n3. A citation/concept graph is an *explicit*, *inspectable* bias.\n4. Putting a GIN-encoded graph prior on z gives higher MIG at equal reconstruction (exp-03: 0.31 vs 0.22).\n5. Ablations show the gain comes from structure, not capacity (exp-06: mean aggregation collapses to baseline).\n\nRisks: dSprites only; downstream benefit unproven (Locatello §5).",
  },
  {
    title: "Ethics — user study",
    body: "# Ethics application #admin\n\nStatus: **blocked** — resubmitted with amended consent form on week 21.\n\nStudy: 12 participants rate latent traversals for interpretability. Needed for §5 only; thesis stands without it.",
  },
  {
    title: "Ideas parking lot",
    body: "- Flow posterior for a tighter bound (Kobyzev survey) — future work paragraph\n- Hierarchical prior (Ladder VAE) — only if graph-prior v1 plateaus\n- Use DGI to pre-train the graph encoder #gnn #self-supervised\n- Diffusion decoder? No. Out of scope. #diffusion",
  },
];

export interface ShowcaseFieldDef {
  name: string;
  kind: "text" | "number" | "select" | "multi_select";
  options?: string[];
  /** paper title → value */
  values: Record<string, unknown>;
}

export const SHOWCASE_FIELDS: ShowcaseFieldDef[] = [
  {
    name: "Relevance",
    kind: "select",
    options: ["core", "supporting", "background", "parked"],
    values: {
      [T.vae]: "core", [T.betaVae]: "core", [T.locatello]: "core", [T.tcvae]: "core", [T.vgae]: "core", [T.gin]: "core", [T.ours]: "core",
      [T.factorVae]: "supporting", [T.dipVae]: "supporting", [T.eastwood]: "supporting", [T.gcn]: "supporting", [T.gat]: "supporting", [T.graphsage]: "supporting", [T.dsprites]: "supporting", [T.iwae]: "supporting",
      [T.attention]: "background", [T.resnet]: "background", [T.gan]: "background", [T.ddpm]: "background", [T.adam]: "background", [T.batchnorm]: "background", [T.dropout]: "background", [T.flows]: "background",
      [T.simclr]: "parked", [T.moco]: "parked", [T.byol]: "parked",
    },
  },
  {
    name: "Code available",
    kind: "select",
    options: ["yes", "no", "unofficial"],
    values: {
      [T.betaVae]: "unofficial", [T.factorVae]: "unofficial", [T.tcvae]: "yes", [T.locatello]: "yes", [T.vgae]: "yes", [T.gcn]: "yes", [T.gat]: "yes", [T.gin]: "yes", [T.graphsage]: "yes", [T.dsprites]: "yes", [T.simclr]: "yes", [T.moco]: "yes", [T.vqVae]: "unofficial", [T.dipVae]: "no",
    },
  },
  {
    name: "Reproduced",
    kind: "select",
    options: ["yes", "partly", "no"],
    values: { [T.betaVae]: "yes", [T.resnet]: "yes", [T.iwae]: "yes", [T.factorVae]: "partly", [T.tcvae]: "partly", [T.vgae]: "no" },
  },
  {
    name: "Thesis chapters",
    kind: "multi_select",
    options: ["1", "2", "3", "4", "5", "6"],
    values: {
      [T.locatello]: ["1", "2", "5"], [T.vae]: ["2", "3"], [T.betaVae]: ["2", "3", "4"], [T.tcvae]: ["2", "4"], [T.gin]: ["2", "3"], [T.vgae]: ["2", "3"], [T.eastwood]: ["2", "4"], [T.dsprites]: ["4"], [T.flows]: ["6"],
    },
  },
  {
    name: "Reading time (min)",
    kind: "number",
    values: { [T.vae]: 90, [T.betaVae]: 60, [T.locatello]: 120, [T.tcvae]: 75, [T.gin]: 50, [T.adam]: 20 },
  },
];

/** Papers with citation alerts turned on. */
export const SHOWCASE_CITATION_TRACKS: string[] = [T.locatello, T.tcvae, T.vgae, T.ours];

/** Dashboard pins: [resource type, name of the thing]. Resolved by name at seed time. */
export const SHOWCASE_PINS: { type: "milestone" | "experiment" | "report_section" | "reading_list" | "paper"; name: string }[] = [
  { type: "milestone", name: "Graph-prior module v1" },
  { type: "experiment", name: "exp-03 Graph-prior v1 — seed 1" },
  { type: "report_section", name: "3.2" },
  { type: "reading_list", name: "VAE & disentanglement" },
  { type: "paper", name: T.locatello },
];

export interface ShowcaseSupervisee {
  label: string;
  milestones: ShowcaseMilestone[];
  log: ShowcaseLogEntry[];
}

export function superviseeShowcase(label: string): ShowcaseSupervisee {
  return {
    label,
    milestones: [
      { title: "Proposal submitted", status: "done", target_date: "2026-02-01", description: `${label}: ethics + proposal signed off` },
      { title: "Pilot user study", status: "in_progress", target_date: "2026-07-01", description: "Recruit 12 participants; pre-register analysis plan" },
      { title: "Write-up", status: "planned", target_date: "2026-08-15" },
    ],
    log: [
      { daysAgo: 1, kind: "daily", body: `${label}: Collected 4/12 pilot sessions. Uploading notes to vault.` },
      { daysAgo: 4, kind: "daily", body: `${label}: Literature skim — added 3 papers to reading list.` },
    ],
  };
}
