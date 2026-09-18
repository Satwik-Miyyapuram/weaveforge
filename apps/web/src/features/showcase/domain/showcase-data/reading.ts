/** Reading lists, one of them a systematic-review screen. */

import { SHOWCASE_TITLES as T } from "./papers";

export interface ShowcaseReadingList {
  name: string;
  description?: string;
  color: string;
  parent?: string;
  papers: string[];
  /** Per-paper note, keyed by title. */
  notes?: Record<string, string>;
}

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
    name: "Systematic review — disentanglement metrics",
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

const SR = "Systematic review — disentanglement metrics";

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
