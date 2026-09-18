/** Zotero-shaped annotations, the pins into report sections and quotation types. */

import { SHOWCASE_TITLES as T, type ShowcaseAnnotation } from "./papers";

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
