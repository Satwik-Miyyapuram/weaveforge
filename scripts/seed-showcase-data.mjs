#!/usr/bin/env node
/**
 * Populate showcase projects for demo accounts (papers, graph, plan, log, exps, …).
 *
 *   node scripts/seed-test-users.mjs      # first
 *   node scripts/seed-showcase-data.mjs   # then
 *
 * Primary account: c@example.com — full thesis workspace
 * Supervisees:     e@example.com, f@example.com — milestones + logbook (for /supervision)
 *
 * Re-running replaces the "MSc Thesis (Showcase)" project per user (cascade delete).
 *
 * Inline paper images + experiment figures use PNGs from scripts/assets/showcase/.
 * Regenerate charts: python scripts/generate-showcase-charts.py
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  appendFigures,
  ensureShowcaseAssets,
  loadShowcaseChart,
  uploadExperimentArtifact,
  uploadPaperImage,
} from "./lib/showcase-images.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const SHOWCASE = "MSc Thesis (Showcase)";

const USERS = {
  phd: "c@example.com",
  mastersE: "e@example.com",
  mastersF: "f@example.com",
};

function loadEnvLocal() {
  const path = resolve(__dir, "../apps/web/.env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

loadEnvLocal();

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or apps/web/.env.local)");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false } });

async function userId(email) {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const u = data.users.find((x) => x.email?.toLowerCase() === email.toLowerCase());
  if (!u) throw new Error(`No user ${email} — run: node scripts/seed-test-users.mjs`);
  return u.id;
}

async function resetShowcaseProject(uid) {
  const { data: existing } = await admin
    .from("projects")
    .select("id")
    .eq("user_id", uid)
    .eq("name", SHOWCASE)
    .maybeSingle();
  if (existing?.id) {
    await admin.from("projects").delete().eq("id", existing.id);
    console.log(`  cleared old "${SHOWCASE}" project`);
  }
  const { data, error } = await admin
    .from("projects")
    .insert({ user_id: uid, name: SHOWCASE, color: "#3b5b8c" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

function metricSeries(name, steps, fn) {
  return Array.from({ length: steps }, (_, step) => ({
    metric: name,
    step,
    value: fn(step),
  }));
}

/**
 * Zotero-shaped PDF annotations, cached on `papers.metadata.annotations` — the
 * same place a real Zotero sync writes them. Keyed by paper title.
 *
 * These drive three surfaces at once, which is why the demo looked empty
 * without them: the paper detail annotation cards, the graph side panel, and
 * the "Pinned annotations" rail beside a report section (via annotation_pins).
 *
 * `annotationPosition` is a real Zotero position — zero-based `pageIndex` plus
 * PDF user-space rects — so the reader has something to anchor to once it
 * renders annotations (reader-and-annotation-plan.md R2). `page` is the display
 * label and is deliberately a string; do not conflate the two.
 */
const SHOWCASE_ANNOTATIONS = {
  "Attention Is All You Need": [
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
  "Auto-Encoding Variational Bayes": [
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
        "Compare the ELBO formulation here against beta-VAE's reweighting — the beta sweep in exp-04 is the empirical version of this trade-off.",
      color: "#2ea8e5",
      page: "4",
      tags: ["vae", "disentanglement"],
      annotationPosition: { pageIndex: 3, rects: [[76.4, 445.0, 120.4, 461.0]] },
      annotationSortIndex: "00003|000221|00445",
    },
  ],
  "β-VAE: Learning Basic Visual Concepts with a Constrained Variational Framework": [
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
};

/** ~20 real-ish papers with overlapping tags so concept nodes populate the graph. */
const SHOWCASE_PAPERS = [
  {
    title: "Attention Is All You Need",
    authors: ["Vaswani et al."],
    year: 2017,
    status: "read",
    tags: ["transformers", "foundations", "representation-learning"],
    summary:
      "Self-attention replaces recurrence for sequence modelling. Key for our encoder baseline and citation in Ch. 2.",
    arxiv_id: "1706.03762",
  },
  {
    title: "Deep Residual Learning for Image Recognition",
    authors: ["He et al."],
    year: 2016,
    status: "read",
    tags: ["cnn", "foundations", "representation-learning"],
    summary: "Skip connections stabilise very deep nets — backbone for experiment sweeps.",
  },
  {
    title: "Auto-Encoding Variational Bayes",
    authors: ["Kingma & Welling"],
    year: 2014,
    status: "read",
    tags: ["vae", "latent-variables", "generative", "foundations"],
    summary: "Foundational VAE — reparameterisation trick and ELBO objective we build on throughout Ch. 2–3.",
    arxiv_id: "1312.6114",
  },
  {
    title: "β-VAE: Learning Basic Visual Concepts with a Constrained Variational Framework",
    authors: ["Higgins et al."],
    year: 2017,
    status: "reading",
    tags: ["vae", "disentanglement", "latent-variables"],
    summary: "β hyperparameter trades reconstruction vs. disentanglement — direct motivation for β sweep.",
  },
  {
    title: "Neural Discrete Representation Learning (VQ-VAE)",
    authors: ["van den Oord et al."],
    year: 2017,
    status: "reading",
    tags: ["vae", "discrete-latent", "generative"],
    summary: "Vector quantisation bottleneck; compare against our continuous latent ablation.",
    arxiv_id: "1711.00937",
  },
  {
    title: "FactorVAE: Disentangling by Factorising",
    authors: ["Kim & Mnih"],
    year: 2018,
    status: "read",
    tags: ["vae", "disentanglement", "latent-variables"],
    summary: "Total-correlation penalty as an alternative to β scaling — cite in disentanglement related work.",
  },
  {
    title: "Challenging Common Assumptions in the Unsupervised Learning of Disentangled Representations",
    authors: ["Locatello et al."],
    year: 2019,
    status: "read",
    tags: ["disentanglement", "vae", "foundations"],
    summary: "Impossibility result without inductive biases — motivates our graph-structured prior.",
    arxiv_id: "1811.12359",
  },
  {
    title: "Generative Adversarial Nets",
    authors: ["Goodfellow et al."],
    year: 2014,
    status: "skimmed",
    tags: ["gan", "generative", "foundations"],
    summary: "Adversarial training baseline; contrast with amortised inference in VAE family.",
  },
  {
    title: "Denoising Diffusion Probabilistic Models",
    authors: ["Ho et al."],
    year: 2020,
    status: "to_read",
    tags: ["diffusion", "generative", "latent-variables"],
    summary: "Modern generative baseline — skim for related-work completeness.",
    arxiv_id: "2006.11239",
  },
  {
    title: "Semi-Supervised Classification with Graph Convolutional Networks",
    authors: ["Kipf & Welling"],
    year: 2017,
    status: "read",
    tags: ["gnn", "semi-supervised", "graph-prior"],
    summary: "Spectral GCN layer — starting point for our graph encoder ablations.",
    arxiv_id: "1609.02907",
  },
  {
    title: "Graph Attention Networks",
    authors: ["Veličković et al."],
    year: 2018,
    status: "reading",
    tags: ["gnn", "attention", "graph-prior"],
    summary: "Attention over neighbourhood — compare to fixed graph prior in our method.",
    arxiv_id: "1710.10903",
  },
  {
    title: "Variational Graph Auto-Encoders",
    authors: ["Kipf & Welling"],
    year: 2016,
    status: "read",
    tags: ["gnn", "vae", "graph-prior", "latent-variables"],
    summary: "VAE on graph-structured data — closest prior work to our contribution.",
    arxiv_id: "1611.07308",
  },
  {
    title: "Neural Relational Inference for Interacting Systems",
    authors: ["Kipf et al."],
    year: 2018,
    status: "skimmed",
    tags: ["gnn", "latent-variables", "graph-prior"],
    summary: "Latent interaction graphs — useful analogy for citation-graph priors.",
  },
  {
    title: "Relational Inductive Biases, Deep Learning, and Graph Networks",
    authors: ["Battaglia et al."],
    year: 2018,
    status: "read",
    tags: ["gnn", "foundations", "representation-learning"],
    summary: "Unified view of graph nets as relational reasoning — frame for thesis intro.",
  },
  {
    title: "A Survey on Graph Neural Networks for Knowledge Graphs",
    authors: ["Wang et al."],
    year: 2022,
    status: "to_read",
    tags: ["gnn", "survey", "graph-prior"],
    summary: "Background reading for related-work section on relational inductive biases.",
  },
  {
    title: "A Survey on Variational Autoencoders from a Green AI Perspective",
    authors: ["Kingma et al."],
    year: 2021,
    status: "skimmed",
    tags: ["vae", "survey", "generative"],
    summary: "Broad VAE taxonomy — sanity-check our notation against standard definitions.",
  },
  {
    title: "A Simple Framework for Contrastive Learning of Visual Representations (SimCLR)",
    authors: ["Chen et al."],
    year: 2020,
    status: "to_read",
    tags: ["contrastive", "self-supervised", "representation-learning"],
    summary: "Strong visual representations without labels — optional baseline for encoder init.",
    arxiv_id: "2002.05709",
  },
  {
    title: "Momentum Contrast for Unsupervised Visual Representation Learning (MoCo)",
    authors: ["He et al."],
    year: 2020,
    status: "to_read",
    tags: ["contrastive", "self-supervised", "cnn"],
    summary: "Dictionary queue for contrastive learning — pairs with ResNet backbone experiments.",
    arxiv_id: "1911.05722",
  },
  {
    title: "InfoGAN: Interpretable Representation Learning by Information Maximizing GANs",
    authors: ["Chen et al."],
    year: 2016,
    status: "skimmed",
    tags: ["gan", "disentanglement", "latent-variables"],
    summary: "Mutual-information disentanglement in GANs — contrast with VAE-based approaches.",
  },
  {
    title: "Your Method (Placeholder Preprint)",
    authors: ["Test PhD C"],
    year: 2026,
    status: "skimmed",
    tags: ["thesis", "graph-prior", "vae", "disentanglement"],
    summary: "Internal draft outlining our contribution — keep synced with report Ch. 4.",
  },
];

/** [fromTitle, toTitle, relation, note?] — dense enough for default cites-only graph view. */
const SHOWCASE_RELATIONS = [
  ["Your Method (Placeholder Preprint)", "β-VAE: Learning Basic Visual Concepts with a Constrained Variational Framework", "extends", "Graph prior generalises β-VAE"],
  ["Your Method (Placeholder Preprint)", "Variational Graph Auto-Encoders", "builds_on"],
  ["Your Method (Placeholder Preprint)", "Challenging Common Assumptions in the Unsupervised Learning of Disentangled Representations", "cites", "Inductive bias argument"],
  ["Your Method (Placeholder Preprint)", "A Survey on Graph Neural Networks for Knowledge Graphs", "cites"],
  ["β-VAE: Learning Basic Visual Concepts with a Constrained Variational Framework", "Auto-Encoding Variational Bayes", "extends"],
  ["FactorVAE: Disentangling by Factorising", "β-VAE: Learning Basic Visual Concepts with a Constrained Variational Framework", "extends"],
  ["FactorVAE: Disentangling by Factorising", "Auto-Encoding Variational Bayes", "builds_on"],
  ["Neural Discrete Representation Learning (VQ-VAE)", "Auto-Encoding Variational Bayes", "extends"],
  ["Challenging Common Assumptions in the Unsupervised Learning of Disentangled Representations", "β-VAE: Learning Basic Visual Concepts with a Constrained Variational Framework", "contradicts", "No free disentanglement"],
  ["Challenging Common Assumptions in the Unsupervised Learning of Disentangled Representations", "FactorVAE: Disentangling by Factorising", "cites"],
  ["InfoGAN: Interpretable Representation Learning by Information Maximizing GANs", "Generative Adversarial Nets", "extends"],
  ["InfoGAN: Interpretable Representation Learning by Information Maximizing GANs", "β-VAE: Learning Basic Visual Concepts with a Constrained Variational Framework", "similar"],
  ["Denoising Diffusion Probabilistic Models", "Auto-Encoding Variational Bayes", "similar"],
  ["Denoising Diffusion Probabilistic Models", "Generative Adversarial Nets", "similar"],
  ["Graph Attention Networks", "Attention Is All You Need", "uses_method"],
  ["Graph Attention Networks", "Semi-Supervised Classification with Graph Convolutional Networks", "extends"],
  ["Variational Graph Auto-Encoders", "Auto-Encoding Variational Bayes", "extends"],
  ["Variational Graph Auto-Encoders", "Semi-Supervised Classification with Graph Convolutional Networks", "uses_method"],
  ["Neural Relational Inference for Interacting Systems", "Variational Graph Auto-Encoders", "similar"],
  ["Neural Relational Inference for Interacting Systems", "Graph Attention Networks", "uses_method"],
  ["Relational Inductive Biases, Deep Learning, and Graph Networks", "Semi-Supervised Classification with Graph Convolutional Networks", "cites"],
  ["Relational Inductive Biases, Deep Learning, and Graph Networks", "Graph Attention Networks", "cites"],
  ["A Survey on Graph Neural Networks for Knowledge Graphs", "Relational Inductive Biases, Deep Learning, and Graph Networks", "cites"],
  ["A Survey on Variational Autoencoders from a Green AI Perspective", "Auto-Encoding Variational Bayes", "cites"],
  ["A Survey on Variational Autoencoders from a Green AI Perspective", "β-VAE: Learning Basic Visual Concepts with a Constrained Variational Framework", "cites"],
  ["A Simple Framework for Contrastive Learning of Visual Representations (SimCLR)", "Momentum Contrast for Unsupervised Visual Representation Learning (MoCo)", "similar"],
  ["A Simple Framework for Contrastive Learning of Visual Representations (SimCLR)", "Deep Residual Learning for Image Recognition", "uses_method"],
  ["Momentum Contrast for Unsupervised Visual Representation Learning (MoCo)", "Deep Residual Learning for Image Recognition", "uses_method"],
  ["Neural Discrete Representation Learning (VQ-VAE)", "Deep Residual Learning for Image Recognition", "uses_method"],
  ["Attention Is All You Need", "A Survey on Graph Neural Networks for Knowledge Graphs", "cites"],
  ["Graph Attention Networks", "Relational Inductive Biases, Deep Learning, and Graph Networks", "cites"],
  ["Variational Graph Auto-Encoders", "Graph Attention Networks", "cites"],
  ["Neural Relational Inference for Interacting Systems", "Relational Inductive Biases, Deep Learning, and Graph Networks", "cites"],
  ["FactorVAE: Disentangling by Factorising", "Challenging Common Assumptions in the Unsupervised Learning of Disentangled Representations", "cites"],
  ["β-VAE: Learning Basic Visual Concepts with a Constrained Variational Framework", "FactorVAE: Disentangling by Factorising", "cites"],
  ["Neural Discrete Representation Learning (VQ-VAE)", "Generative Adversarial Nets", "cites"],
  ["Denoising Diffusion Probabilistic Models", "A Survey on Variational Autoencoders from a Green AI Perspective", "cites"],
  ["A Simple Framework for Contrastive Learning of Visual Representations (SimCLR)", "Deep Residual Learning for Image Recognition", "cites"],
  ["Momentum Contrast for Unsupervised Visual Representation Learning (MoCo)", "A Simple Framework for Contrastive Learning of Visual Representations (SimCLR)", "cites"],
  ["Your Method (Placeholder Preprint)", "Variational Graph Auto-Encoders", "cites"],
  ["Your Method (Placeholder Preprint)", "Auto-Encoding Variational Bayes", "cites"],
  ["Semi-Supervised Classification with Graph Convolutional Networks", "Relational Inductive Biases, Deep Learning, and Graph Networks", "cites"],
];

async function seedPhdShowcase(uid, projectId) {
  const hasCharts = ensureShowcaseAssets();

  const papers = SHOWCASE_PAPERS;

  const { data: paperRows, error: paperErr } = await admin
    .from("papers")
    .insert(
      papers.map((p) => ({
        user_id: uid,
        project_id: projectId,
        title: p.title,
        authors: p.authors,
        year: p.year,
        status: p.status,
        tags: p.tags,
        summary: p.summary,
        arxiv_id: p.arxiv_id ?? null,
        // Always send metadata, never conditionally. A multi-row insert uses one
        // column set for every row, so omitting the key here sends an explicit
        // NULL for the papers that have no annotations — and `metadata` is
        // NOT NULL, so the whole batch fails.
        metadata: SHOWCASE_ANNOTATIONS[p.title]
          ? { annotations: SHOWCASE_ANNOTATIONS[p.title] }
          : {},
      })),
    )
    .select("id, title");
  if (paperErr) throw paperErr;

  const byTitle = Object.fromEntries(paperRows.map((r) => [r.title, r.id]));

  if (hasCharts) {
    const paperFigures = {
      "Attention Is All You Need": [["attention-arch", "Transformer encoder block"]],
      "Deep Residual Learning for Image Recognition": [["resnet-block", "Residual skip connection"]],
      "Neural Discrete Representation Learning (VQ-VAE)": [["vqvae-codebook", "Vector quantisation codebook"]],
      "β-VAE: Learning Basic Visual Concepts with a Constrained Variational Framework": [
        ["beta-vae-heatmap", "Latent factor traversals"],
        ["beta-sweep-bar", "β vs reconstruction / disentanglement"],
      ],
      "A Survey on Graph Neural Networks for Knowledge Graphs": [["gnn-graph", "Graph neighbourhood"]],
      "Your Method (Placeholder Preprint)": [["method-overview", "Proposed pipeline"]],
    };

    for (const row of paperRows) {
      const specs = paperFigures[row.title];
      if (!specs?.length) continue;
      const blocks = [];
      for (const [kind, alt] of specs) {
        const { markdown } = await uploadPaperImage(
          admin,
          uid,
          row.id,
          loadShowcaseChart(kind),
          alt,
        );
        blocks.push(markdown);
      }
      const summary = papers.find((p) => p.title === row.title)?.summary ?? "";
      const { error: upErr } = await admin
        .from("papers")
        .update({ summary: appendFigures(summary, blocks) })
        .eq("id", row.id);
      if (upErr) throw upErr;
    }
    console.log("  paper figure notes with inline images");
  }

  await admin.from("paper_relations").insert(
    SHOWCASE_RELATIONS.map(([fromTitle, toTitle, relation, note]) => ({
      user_id: uid,
      project_id: projectId,
      from_paper: byTitle[fromTitle],
      to_paper: byTitle[toTitle],
      relation,
      note: note ?? null,
      source: "manual",
    })),
  );
  console.log(`  ${SHOWCASE_RELATIONS.length} paper relations`);

  const { data: lists, error: listErr } = await admin
    .from("reading_lists")
    .insert([
      {
        user_id: uid,
        project_id: projectId,
        name: "Thesis foundations",
        description: "Core concepts & baselines",
        color: "#5b8def",
        sort_order: 0,
      },
      {
        user_id: uid,
        project_id: projectId,
        name: "Related work — generative models",
        color: "#98c379",
        sort_order: 1,
      },
      {
        user_id: uid,
        project_id: projectId,
        name: "Graph & relational models",
        description: "GNN encoders and graph priors",
        color: "#c98a6b",
        sort_order: 2,
      },
    ])
    .select("id, name");
  if (listErr) throw listErr;

  const foundations = lists.find((l) => l.name === "Thesis foundations")?.id;
  const generative = lists.find((l) => l.name === "Related work — generative models")?.id;
  const graphList = lists.find((l) => l.name === "Graph & relational models")?.id;

  const { data: sublists, error: subErr } = await admin
    .from("reading_lists")
    .insert([
      {
        user_id: uid,
        project_id: projectId,
        parent_id: generative,
        name: "VAE & disentanglement",
        color: "#7c9885",
        sort_order: 0,
      },
      {
        user_id: uid,
        project_id: projectId,
        parent_id: generative,
        name: "Diffusion & adversarial",
        color: "#9a7bb0",
        sort_order: 1,
      },
      {
        user_id: uid,
        project_id: projectId,
        parent_id: graphList,
        name: "GNN architectures",
        color: "#5a7d8c",
        sort_order: 0,
      },
      {
        user_id: uid,
        project_id: projectId,
        parent_id: graphList,
        name: "Graph–VAE hybrids",
        color: "#c98a6b",
        sort_order: 1,
      },
    ])
    .select("id, name");
  if (subErr) throw subErr;

  const vaeSub = sublists.find((l) => l.name === "VAE & disentanglement")?.id;
  const diffSub = sublists.find((l) => l.name === "Diffusion & adversarial")?.id;
  const gnnSub = sublists.find((l) => l.name === "GNN architectures")?.id;
  const hybridSub = sublists.find((l) => l.name === "Graph–VAE hybrids")?.id;

  await admin.from("reading_list_items").insert([
    { list_id: foundations, paper_id: byTitle["Attention Is All You Need"], sort_order: 0 },
    { list_id: foundations, paper_id: byTitle["Deep Residual Learning for Image Recognition"], sort_order: 1 },
    { list_id: foundations, paper_id: byTitle["Relational Inductive Biases, Deep Learning, and Graph Networks"], sort_order: 2 },
    { list_id: vaeSub, paper_id: byTitle["Auto-Encoding Variational Bayes"], sort_order: 0 },
    { list_id: vaeSub, paper_id: byTitle["β-VAE: Learning Basic Visual Concepts with a Constrained Variational Framework"], sort_order: 1 },
    { list_id: vaeSub, paper_id: byTitle["FactorVAE: Disentangling by Factorising"], sort_order: 2 },
    { list_id: vaeSub, paper_id: byTitle["Challenging Common Assumptions in the Unsupervised Learning of Disentangled Representations"], sort_order: 3 },
    { list_id: diffSub, paper_id: byTitle["Neural Discrete Representation Learning (VQ-VAE)"], sort_order: 0 },
    { list_id: diffSub, paper_id: byTitle["Denoising Diffusion Probabilistic Models"], sort_order: 1 },
    { list_id: diffSub, paper_id: byTitle["Generative Adversarial Nets"], sort_order: 2 },
    { list_id: diffSub, paper_id: byTitle["InfoGAN: Interpretable Representation Learning by Information Maximizing GANs"], sort_order: 3 },
    { list_id: gnnSub, paper_id: byTitle["Semi-Supervised Classification with Graph Convolutional Networks"], sort_order: 0 },
    { list_id: gnnSub, paper_id: byTitle["Graph Attention Networks"], sort_order: 1 },
    { list_id: gnnSub, paper_id: byTitle["A Survey on Graph Neural Networks for Knowledge Graphs"], sort_order: 2 },
    { list_id: hybridSub, paper_id: byTitle["Variational Graph Auto-Encoders"], sort_order: 0 },
    { list_id: hybridSub, paper_id: byTitle["Neural Relational Inference for Interacting Systems"], sort_order: 1 },
    { list_id: hybridSub, paper_id: byTitle["Your Method (Placeholder Preprint)"], sort_order: 2 },
  ]);

  const { data: milestones, error: msErr } = await admin
    .from("milestones")
    .insert([
      {
        user_id: uid,
        project_id: projectId,
        title: "Literature review draft",
        description: "Ch. 2 complete with 40+ papers mapped in graph",
        status: "done",
        target_date: "2026-03-15",
        dependencies: [],
        compute: [],
      },
      {
        user_id: uid,
        project_id: projectId,
        title: "Baseline reproduction",
        description: "ResNet-18 + β-VAE baselines match published curves",
        status: "in_progress",
        target_date: "2026-05-01",
        compute: [{ resource: "A100", count: 2, hours: 80, notes: "sweep β ∈ {2,4,8}" }],
        dependencies: [],
      },
      {
        user_id: uid,
        project_id: projectId,
        title: "Ablation study",
        status: "planned",
        target_date: "2026-06-15",
        dependencies: [{ kind: "external", label: "Ethics approval" }],
        compute: [],
      },
      {
        user_id: uid,
        project_id: projectId,
        title: "Thesis submission",
        status: "planned",
        target_date: "2026-09-01",
        dependencies: [],
        compute: [],
      },
    ])
    .select("id");
  if (msErr) throw msErr;

  const today = new Date();
  const daysAgo = (n) => {
    const d = new Date(today);
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  };

  await admin.from("log_entries").insert([
    {
      user_id: uid,
      project_id: projectId,
      entry_date: daysAgo(2),
      kind: "daily",
      body: "Finished β-VAE reproduction — loss curves match Higgins et al. within 2%. Next: wire SDK live logging.",
    },
    {
      user_id: uid,
      project_id: projectId,
      entry_date: daysAgo(5),
      kind: "daily",
      body: "Added 20 papers to graph with 40+ typed edges. Concept tags (#vae, #gnn, #disentanglement) bridge clusters — toggle concepts in graph filters to explore.",
    },
    {
      user_id: uid,
      project_id: projectId,
      entry_date: daysAgo(12),
      kind: "weekly",
      body: "**Week 12** — Graph module useful for spotting missing citations. Plan: run compare view across 3 experiment seeds.",
    },
  ]);

  const { data: exps, error: expErr } = await admin
    .from("experiments")
    .insert([
      {
        user_id: uid,
        project_id: projectId,
        name: "β-VAE sweep — seed 42",
        hypothesis: "Higher β improves disentanglement at cost of reconstruction",
        status: "done",
        config: { beta: 4, lr: 1e-3, batch_size: 64, seed: 42 },
        metrics: { val_loss: 0.1826, recon_loss: 0.0912 },
        branch: "main",
        commit_sha: "a1b2c3d4e5f6",
        related_paper: byTitle["β-VAE: Learning Basic Visual Concepts with a Constrained Variational Framework"],
        started_at: new Date(Date.now() - 7 * 864e5).toISOString(),
        finished_at: new Date(Date.now() - 6 * 864e5).toISOString(),
      },
      {
        user_id: uid,
        project_id: projectId,
        name: "ResNet-18 baseline",
        status: "done",
        config: { model: "resnet18", epochs: 50 },
        metrics: { accuracy: 0.912, val_loss: 0.34 },
      },
      {
        user_id: uid,
        project_id: projectId,
        name: "Graph-prior ablation (running)",
        status: "running",
        config: { graph_layers: 2, beta: 4 },
        metrics: { train_loss: 0.52 },
        started_at: new Date().toISOString(),
      },
    ])
    .select("id, name");
  if (expErr) throw expErr;

  const betaExp = exps.find((e) => e.name.includes("β-VAE"))?.id;
  const resnetExp = exps.find((e) => e.name.includes("ResNet"))?.id;
  const graphExp = exps.find((e) => e.name.includes("Graph-prior"))?.id;

  if (hasCharts) {
    const artifactSpecs = [
      [betaExp, [
        ["beta-loss-curve", "train-loss.png"],
        ["beta-recon-grid", "recon-grid.png"],
        ["beta-sweep-bar", "beta-sweep.png"],
      ]],
      [resnetExp, [
        ["resnet-accuracy", "val-accuracy.png"],
        ["resnet-training", "training-curves.png"],
      ]],
      [graphExp, [
        ["graph-prior-loss", "train-loss.png"],
        ["graph-prior-structure", "graph-structure.png"],
      ]],
    ];

    for (const [expId, figures] of artifactSpecs) {
      if (!expId) continue;
      const urls = [];
      for (const [kind, name] of figures) {
        urls.push(await uploadExperimentArtifact(admin, uid, expId, name, loadShowcaseChart(kind)));
      }
      const { error: artErr } = await admin.from("experiments").update({ artifacts: urls }).eq("id", expId);
      if (artErr) throw artErr;
    }
    console.log("  experiment figure artifacts");
  }

  if (betaExp) {
    const points = [
      ...metricSeries("train_loss", 30, (s) => +(0.9 * Math.exp(-s / 12) + 0.08).toFixed(4)),
      ...metricSeries("accuracy", 30, (s) => +(0.1 + s * 0.028).toFixed(4)),
    ].map((p) => ({ ...p, user_id: uid, experiment_id: betaExp }));
    await admin.from("experiment_metrics").insert(points);
  }

  const { data: ch1, error: r1Err } = await admin
    .from("report_sections")
    .insert({
      user_id: uid,
      project_id: projectId,
      title: "Introduction",
      section_no: "1",
      status: "drafting",
      word_count: 1200,
      target_words: 2500,
      sort_order: 0,
    })
    .select("id")
    .single();
  if (r1Err) throw r1Err;

  const { data: ch2, error: r2Err } = await admin
    .from("report_sections")
    .insert({
      user_id: uid,
      project_id: projectId,
      title: "Background",
      section_no: "2",
      status: "drafting",
      word_count: 2800,
      target_words: 4000,
      sort_order: 1,
    })
    .select("id")
    .single();
  if (r2Err) throw r2Err;

  // Pin annotations into Background so the "Pinned annotations" rail beside the
  // section editor has content. Without these the rail renders its empty state
  // even though the annotations exist on the papers.
  const annotationPins = [
    ["Attention Is All You Need", "SHOWCASE-ATTN-1"],
    ["Auto-Encoding Variational Bayes", "SHOWCASE-VAE-1"],
    ["β-VAE: Learning Basic Visual Concepts with a Constrained Variational Framework", "SHOWCASE-BVAE-1"],
  ]
    .filter(([title]) => byTitle[title])
    .map(([title, annotationKey]) => ({
      user_id: uid,
      project_id: projectId,
      paper_id: byTitle[title],
      annotation_key: annotationKey,
      report_section_id: ch2.id,
    }));
  if (annotationPins.length) {
    const { error: pinErr } = await admin.from("annotation_pins").insert(annotationPins);
    if (pinErr) throw pinErr;
  }

  // Phase F quotation taxonomy (migration 0107) — one of each so the selector
  // on the annotation card demos all three states.
  const quotationTypes = [
    ["Attention Is All You Need", "SHOWCASE-ATTN-1", "direct"],
    ["Attention Is All You Need", "SHOWCASE-ATTN-2", "paraphrase"],
    ["β-VAE: Learning Basic Visual Concepts with a Constrained Variational Framework", "SHOWCASE-BVAE-1", "summary"],
  ]
    .filter(([title]) => byTitle[title])
    .map(([title, annotationKey, quotationType]) => ({
      user_id: uid,
      project_id: projectId,
      paper_id: byTitle[title],
      annotation_key: annotationKey,
      quotation_type: quotationType,
    }));
  if (quotationTypes.length) {
    const { error: qtErr } = await admin
      .from("annotation_quotation_types")
      .insert(quotationTypes);
    if (qtErr) throw qtErr;
  }

  const { data: ch3, error: r3Err } = await admin
    .from("report_sections")
    .insert({
      user_id: uid,
      project_id: projectId,
      title: "Method",
      section_no: "3",
      status: "not_started",
      target_words: 5000,
      sort_order: 2,
    })
    .select("id")
    .single();
  if (r3Err) throw r3Err;

  await admin.from("report_sections").insert({
    user_id: uid,
    project_id: projectId,
    title: "Conclusion",
    section_no: "6",
    status: "not_started",
    target_words: 1500,
    sort_order: 3,
  });

  const { data: introKids, error: introKidsErr } = await admin
    .from("report_sections")
    .insert([
      {
        user_id: uid,
        project_id: projectId,
        parent_id: ch1.id,
        title: "Problem statement",
        section_no: "1.1",
        status: "drafting",
        word_count: 600,
        target_words: 900,
        sort_order: 0,
      },
      {
        user_id: uid,
        project_id: projectId,
        parent_id: ch1.id,
        title: "Contributions",
        section_no: "1.2",
        status: "drafting",
        word_count: 400,
        target_words: 800,
        sort_order: 1,
      },
    ])
    .select("id, title");
  if (introKidsErr) throw introKidsErr;

  const { data: bgKids, error: bgKidsErr } = await admin
    .from("report_sections")
    .insert([
      {
        user_id: uid,
        project_id: projectId,
        parent_id: ch2.id,
        title: "Generative models",
        section_no: "2.1",
        status: "drafting",
        word_count: 1400,
        target_words: 2000,
        sort_order: 0,
      },
      {
        user_id: uid,
        project_id: projectId,
        parent_id: ch2.id,
        title: "Graph neural networks",
        section_no: "2.2",
        status: "drafting",
        word_count: 1100,
        target_words: 1800,
        sort_order: 1,
      },
    ])
    .select("id, title");
  if (bgKidsErr) throw bgKidsErr;

  const bgGen = bgKids.find((s) => s.title === "Generative models")?.id;

  await admin.from("report_sections").insert([
    {
      user_id: uid,
      project_id: projectId,
      parent_id: bgGen,
      title: "VAE variants",
      section_no: "2.1.1",
      status: "drafting",
      word_count: 520,
      target_words: 900,
      sort_order: 0,
    },
    {
      user_id: uid,
      project_id: projectId,
      parent_id: bgGen,
      title: "Disentanglement literature",
      section_no: "2.1.2",
      status: "not_started",
      target_words: 700,
      sort_order: 1,
    },
    {
      user_id: uid,
      project_id: projectId,
      parent_id: ch3.id,
      title: "Encoder architecture",
      section_no: "3.1",
      status: "not_started",
      target_words: 2200,
      sort_order: 0,
    },
    {
      user_id: uid,
      project_id: projectId,
      parent_id: ch3.id,
      title: "Graph-prior module",
      section_no: "3.2",
      status: "not_started",
      target_words: 2400,
      sort_order: 1,
    },
  ]);

  await admin.from("vault_pages").insert([
    {
      user_id: uid,
      project_id: projectId,
      title: "Core concepts",
      body: "## Latent variable models #vae #elbo #latent-variables\n\n- **ELBO** — trade-off between reconstruction and KL\n- **β-VAE** — scale KL term for disentanglement\n- **FactorVAE** — total-correlation penalty variant\n\n## Graph prior #gnn #graph-prior\n\nNodes = concepts, edges = citations or dependencies. See VGAE + GAT papers in the graph.",
      sort_order: 0,
    },
    {
      user_id: uid,
      project_id: projectId,
      title: "Disentanglement reading cluster",
      body: "Papers to compare in the graph view:\n\n- β-VAE, FactorVAE, InfoGAN, Locatello impossibility result\n- Our graph prior as an explicit inductive bias #disentanglement #vae\n\nOpen graph → enable **concepts** + **co-occurrence** for tag bridges.",
      sort_order: 1,
    },
    {
      user_id: uid,
      project_id: projectId,
      title: "Contrastive encoder baselines",
      body: "Optional ResNet init from #contrastive #self-supervised runs (SimCLR, MoCo). Lower priority than VAE line. #representation-learning",
      sort_order: 2,
    },
    {
      user_id: uid,
      project_id: projectId,
      title: "Meeting notes — supervisor",
      body: "- Focus ablation on β and graph depth #disentanglement #graph-prior\n- Target NeurIPS workshop deadline\n- Share compare view link next sync",
      sort_order: 3,
    },
  ]);

  return { papers: paperRows.length, milestones: milestones.length, experiments: exps.length };
}

async function seedSuperviseeShowcase(uid, projectId, label) {
  await admin.from("milestones").insert([
    {
      user_id: uid,
      project_id: projectId,
      title: "Proposal submitted",
      status: "done",
      target_date: "2026-02-01",
      description: `${label}: ethics + proposal signed off`,
      dependencies: [],
      compute: [],
    },
    {
      user_id: uid,
      project_id: projectId,
      title: "Pilot user study",
      status: "in_progress",
      target_date: "2026-07-01",
      description: "Recruit 12 participants; pre-register analysis plan",
      dependencies: [],
      compute: [],
    },
    {
      user_id: uid,
      project_id: projectId,
      title: "Write-up",
      status: "planned",
      target_date: "2026-08-15",
      dependencies: [],
      compute: [],
    },
  ]);

  const daysAgo = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  };

  await admin.from("log_entries").insert([
    {
      user_id: uid,
      project_id: projectId,
      entry_date: daysAgo(1),
      kind: "daily",
      body: `${label}: Collected 4/12 pilot sessions. Uploading notes to vault.`,
    },
    {
      user_id: uid,
      project_id: projectId,
      entry_date: daysAgo(4),
      kind: "daily",
      body: `${label}: Literature skim — added 3 papers to reading list.`,
    },
  ]);
}

async function seedUser(email, fn) {
  console.log(`\n${email}`);
  const uid = await userId(email);
  const projectId = await resetShowcaseProject(uid);
  const stats = await fn(uid, projectId);
  console.log(`  project "${SHOWCASE}" (${projectId})`);
  if (stats) console.log(`  →`, stats);
}

async function main() {
  console.log("Seeding showcase data…");
  await seedUser(USERS.phd, seedPhdShowcase);
  await seedUser(USERS.mastersE, (uid, pid) => seedSuperviseeShowcase(uid, pid, "Masters E"));
  await seedUser(USERS.mastersF, (uid, pid) => seedSuperviseeShowcase(uid, pid, "Masters F"));

  console.log("\nDone.");
  console.log("  Sign in as c@example.com → pick project **MSc Thesis (Showcase)**");
  console.log("  Supervision: c@example.com → /supervision → view E or F");
  console.log("  Re-record README clips: npm run record:demos");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
