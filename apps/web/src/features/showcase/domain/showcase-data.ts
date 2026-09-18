/**
 * The demo workspace, as data.
 *
 * One thesis — a graph-structured prior for disentangled VAEs — described
 * completely enough that every screen has something to show: thirty-odd
 * papers with typed relations and tags, reading lists (one of them a
 * systematic-review screen), Zotero-shaped annotations pinned into a report,
 * milestones with compute and dependencies, a logbook, experiments with metric
 * curves and figures, a report outline, a vault of notes, custom paper fields
 * and citation alerts.
 *
 * Nothing here touches a database. `seedShowcase` (infrastructure) writes it
 * through whatever client it is handed, which is how the same workspace lands
 * in a Supabase account and in the no-account copy on a desktop.
 */

export const SHOWCASE_PROJECT_NAME = "MSc Thesis (Showcase)";
export const SHOWCASE_PROJECT_COLOR = "#3b5b8c";

export type ShowcasePaperStatus = "to_read" | "reading" | "read" | "skimmed";

export interface ShowcasePaper {
  title: string;
  authors: string[];
  year: number;
  status: ShowcasePaperStatus;
  tags: string[];
  summary: string;
  venue?: string;
  doi?: string;
  arxiv_id?: string;
  url?: string;
  abstract?: string;
  rating?: 1 | 2 | 3 | 4 | 5;
  /** Days before the seed date the paper was finished. */
  readDaysAgo?: number;
  bibtex?: string;
}

export type ShowcaseRelation = "cites" | "extends" | "contradicts" | "similar" | "builds_on" | "uses_method";

/** [fromTitle, toTitle, relation, note?] */
export type ShowcaseRelationRow = [string, string, ShowcaseRelation, string?];

/** A figure to inline into a paper's notes: [chart kind, alt text]. */
export type ShowcaseFigure = [string, string];

export interface ShowcaseAnnotation {
  key: string;
  kind: "annotation" | "note";
  annotationType: "highlight" | "note" | "underline";
  text?: string;
  comment: string;
  color: string;
  page: string;
  tags: string[];
  annotationPosition: { pageIndex: number; rects: number[][] };
  annotationSortIndex: string;
}

/** Short titles used as keys below, so the relation table stays readable. */
const T = {
  attention: "Attention Is All You Need",
  resnet: "Deep Residual Learning for Image Recognition",
  vae: "Auto-Encoding Variational Bayes",
  betaVae: "β-VAE: Learning Basic Visual Concepts with a Constrained Variational Framework",
  vqVae: "Neural Discrete Representation Learning (VQ-VAE)",
  factorVae: "FactorVAE: Disentangling by Factorising",
  locatello: "Challenging Common Assumptions in the Unsupervised Learning of Disentangled Representations",
  gan: "Generative Adversarial Nets",
  ddpm: "Denoising Diffusion Probabilistic Models",
  gcn: "Semi-Supervised Classification with Graph Convolutional Networks",
  gat: "Graph Attention Networks",
  vgae: "Variational Graph Auto-Encoders",
  nri: "Neural Relational Inference for Interacting Systems",
  battaglia: "Relational Inductive Biases, Deep Learning, and Graph Networks",
  gnnSurvey: "A Survey on Graph Neural Networks for Knowledge Graphs",
  vaeSurvey: "A Survey on Variational Autoencoders from a Green AI Perspective",
  simclr: "A Simple Framework for Contrastive Learning of Visual Representations (SimCLR)",
  moco: "Momentum Contrast for Unsupervised Visual Representation Learning (MoCo)",
  infogan: "InfoGAN: Interpretable Representation Learning by Information Maximizing GANs",
  ours: "Your Method (Placeholder Preprint)",
  cvae: "Learning Structured Output Representation using Deep Conditional Generative Models",
  iwae: "Importance Weighted Autoencoders",
  tcvae: "Isolating Sources of Disentanglement in Variational Autoencoders",
  dipVae: "Variational Inference of Disentangled Latent Concepts from Unlabeled Observations",
  ladder: "Ladder Variational Autoencoders",
  adam: "Adam: A Method for Stochastic Optimization",
  batchnorm: "Batch Normalization: Accelerating Deep Network Training by Reducing Internal Covariate Shift",
  dropout: "Dropout: A Simple Way to Prevent Neural Networks from Overfitting",
  graphsage: "Inductive Representation Learning on Large Graphs",
  gin: "How Powerful are Graph Neural Networks?",
  dgi: "Deep Graph Infomax",
  sde: "Score-Based Generative Modeling through Stochastic Differential Equations",
  dsprites: "dSprites: Disentanglement Testing Sprites Dataset",
  eastwood: "A Framework for the Quantitative Evaluation of Disentangled Representations",
  byol: "Bootstrap Your Own Latent: A New Approach to Self-Supervised Learning",
  flows: "Normalizing Flows: An Introduction and Review of Current Methods",
} as const;

export const SHOWCASE_TITLES = T;

export const SHOWCASE_PAPERS: ShowcasePaper[] = [
  {
    title: T.attention,
    authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar", "Jakob Uszkoreit", "Llion Jones", "Aidan N. Gomez", "Łukasz Kaiser", "Illia Polosukhin"],
    year: 2017,
    venue: "NeurIPS",
    status: "read",
    rating: 5,
    readDaysAgo: 140,
    tags: ["transformers", "foundations", "representation-learning"],
    arxiv_id: "1706.03762",
    url: "https://arxiv.org/abs/1706.03762",
    abstract:
      "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks that include an encoder and a decoder. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms.",
    summary:
      "Self-attention replaces recurrence for sequence modelling. Key for our encoder baseline and citation in Ch. 2.\n\n**Why it matters here:** the graph-prior module reuses multi-head attention over neighbourhoods (see GAT), so the notation in §3.2 follows this paper.",
    bibtex:
      "@inproceedings{vaswani2017attention,\n  title={Attention is all you need},\n  author={Vaswani, Ashish and Shazeer, Noam and Parmar, Niki and Uszkoreit, Jakob and Jones, Llion and Gomez, Aidan N and Kaiser, {\\L}ukasz and Polosukhin, Illia},\n  booktitle={Advances in Neural Information Processing Systems},\n  volume={30},\n  year={2017}\n}",
  },
  {
    title: T.resnet,
    authors: ["Kaiming He", "Xiangyu Zhang", "Shaoqing Ren", "Jian Sun"],
    year: 2016,
    venue: "CVPR",
    status: "read",
    rating: 5,
    readDaysAgo: 150,
    doi: "10.1109/CVPR.2016.90",
    arxiv_id: "1512.03385",
    tags: ["cnn", "foundations", "representation-learning"],
    summary: "Skip connections stabilise very deep nets — backbone for every encoder in the experiment sweeps.",
  },
  {
    title: T.vae,
    authors: ["Diederik P. Kingma", "Max Welling"],
    year: 2014,
    venue: "ICLR",
    status: "read",
    rating: 5,
    readDaysAgo: 160,
    tags: ["vae", "latent-variables", "generative", "foundations"],
    arxiv_id: "1312.6114",
    url: "https://arxiv.org/abs/1312.6114",
    abstract:
      "How can we perform efficient inference and learning in directed probabilistic models, in the presence of continuous latent variables with intractable posterior distributions, and large datasets? We introduce a stochastic variational inference and learning algorithm that scales to large datasets.",
    summary:
      "Foundational VAE — reparameterisation trick and ELBO objective we build on throughout Ch. 2–3.\n\n$$\\mathcal{L}(\\theta,\\phi;x) = \\mathbb{E}_{q_\\phi(z|x)}[\\log p_\\theta(x|z)] - D_{KL}(q_\\phi(z|x)\\,\\|\\,p(z))$$",
    bibtex:
      "@inproceedings{kingma2014vae,\n  title={Auto-Encoding Variational Bayes},\n  author={Kingma, Diederik P and Welling, Max},\n  booktitle={International Conference on Learning Representations},\n  year={2014}\n}",
  },
  {
    title: T.betaVae,
    authors: ["Irina Higgins", "Loïc Matthey", "Arka Pal", "Christopher Burgess", "Xavier Glorot", "Matthew Botvinick", "Shakir Mohamed", "Alexander Lerchner"],
    year: 2017,
    venue: "ICLR",
    status: "reading",
    rating: 4,
    tags: ["vae", "disentanglement", "latent-variables"],
    url: "https://openreview.net/forum?id=Sy2fzU9gl",
    summary: "β hyperparameter trades reconstruction vs. disentanglement — direct motivation for the β sweep (exp-01).",
  },
  {
    title: T.vqVae,
    authors: ["Aäron van den Oord", "Oriol Vinyals", "Koray Kavukcuoglu"],
    year: 2017,
    venue: "NeurIPS",
    status: "reading",
    rating: 4,
    tags: ["vae", "discrete-latent", "generative"],
    arxiv_id: "1711.00937",
    summary: "Vector quantisation bottleneck; compare against our continuous latent ablation.",
  },
  {
    title: T.factorVae,
    authors: ["Hyunjik Kim", "Andriy Mnih"],
    year: 2018,
    venue: "ICML",
    status: "read",
    rating: 4,
    readDaysAgo: 90,
    arxiv_id: "1802.05983",
    tags: ["vae", "disentanglement", "latent-variables"],
    summary: "Total-correlation penalty as an alternative to β scaling — cite in disentanglement related work.",
  },
  {
    title: T.locatello,
    authors: ["Francesco Locatello", "Stefan Bauer", "Mario Lucic", "Gunnar Rätsch", "Sylvain Gelly", "Bernhard Schölkopf", "Olivier Bachem"],
    year: 2019,
    venue: "ICML",
    status: "read",
    rating: 5,
    readDaysAgo: 75,
    tags: ["disentanglement", "vae", "foundations"],
    arxiv_id: "1811.12359",
    abstract:
      "We provide a sober look at recent progress in the field and challenge some common assumptions. We first theoretically show that the unsupervised learning of disentangled representations is fundamentally impossible without inductive biases on both the models and the data.",
    summary: "Impossibility result without inductive biases — motivates our graph-structured prior. **The** citation for the thesis argument.",
  },
  {
    title: T.gan,
    authors: ["Ian Goodfellow", "Jean Pouget-Abadie", "Mehdi Mirza", "Bing Xu", "David Warde-Farley", "Sherjil Ozair", "Aaron Courville", "Yoshua Bengio"],
    year: 2014,
    venue: "NeurIPS",
    status: "skimmed",
    rating: 4,
    tags: ["gan", "generative", "foundations"],
    arxiv_id: "1406.2661",
    summary: "Adversarial training baseline; contrast with amortised inference in VAE family.",
  },
  {
    title: T.ddpm,
    authors: ["Jonathan Ho", "Ajay Jain", "Pieter Abbeel"],
    year: 2020,
    venue: "NeurIPS",
    status: "to_read",
    tags: ["diffusion", "generative", "latent-variables"],
    arxiv_id: "2006.11239",
    summary: "Modern generative baseline — skim for related-work completeness.",
  },
  {
    title: T.gcn,
    authors: ["Thomas N. Kipf", "Max Welling"],
    year: 2017,
    venue: "ICLR",
    status: "read",
    rating: 5,
    readDaysAgo: 120,
    tags: ["gnn", "semi-supervised", "graph-prior"],
    arxiv_id: "1609.02907",
    summary: "Spectral GCN layer — starting point for our graph encoder ablations.",
  },
  {
    title: T.gat,
    authors: ["Petar Veličković", "Guillem Cucurull", "Arantxa Casanova", "Adriana Romero", "Pietro Liò", "Yoshua Bengio"],
    year: 2018,
    venue: "ICLR",
    status: "reading",
    rating: 4,
    tags: ["gnn", "attention", "graph-prior"],
    arxiv_id: "1710.10903",
    summary: "Attention over neighbourhood — compare to fixed graph prior in our method.",
  },
  {
    title: T.vgae,
    authors: ["Thomas N. Kipf", "Max Welling"],
    year: 2016,
    venue: "NeurIPS Workshop on Bayesian Deep Learning",
    status: "read",
    rating: 5,
    readDaysAgo: 100,
    tags: ["gnn", "vae", "graph-prior", "latent-variables"],
    arxiv_id: "1611.07308",
    summary: "VAE on graph-structured data — closest prior work to our contribution.",
  },
  {
    title: T.nri,
    authors: ["Thomas Kipf", "Ethan Fetaya", "Kuan-Chieh Wang", "Max Welling", "Richard Zemel"],
    year: 2018,
    venue: "ICML",
    status: "skimmed",
    rating: 3,
    tags: ["gnn", "latent-variables", "graph-prior"],
    arxiv_id: "1802.04687",
    summary: "Latent interaction graphs — useful analogy for citation-graph priors.",
  },
  {
    title: T.battaglia,
    authors: ["Peter W. Battaglia", "Jessica B. Hamrick", "Victor Bapst", "et al."],
    year: 2018,
    status: "read",
    rating: 4,
    readDaysAgo: 130,
    tags: ["gnn", "foundations", "representation-learning"],
    arxiv_id: "1806.01261",
    summary: "Unified view of graph nets as relational reasoning — frame for thesis intro.",
  },
  {
    title: T.gnnSurvey,
    authors: ["Wang et al."],
    year: 2022,
    status: "to_read",
    tags: ["gnn", "survey", "graph-prior"],
    summary: "Background reading for related-work section on relational inductive biases.",
  },
  {
    title: T.vaeSurvey,
    authors: ["Kingma et al."],
    year: 2021,
    status: "skimmed",
    rating: 3,
    tags: ["vae", "survey", "generative"],
    summary: "Broad VAE taxonomy — sanity-check our notation against standard definitions.",
  },
  {
    title: T.simclr,
    authors: ["Ting Chen", "Simon Kornblith", "Mohammad Norouzi", "Geoffrey Hinton"],
    year: 2020,
    venue: "ICML",
    status: "to_read",
    tags: ["contrastive", "self-supervised", "representation-learning"],
    arxiv_id: "2002.05709",
    summary: "Strong visual representations without labels — optional baseline for encoder init.",
  },
  {
    title: T.moco,
    authors: ["Kaiming He", "Haoqi Fan", "Yuxin Wu", "Saining Xie", "Ross Girshick"],
    year: 2020,
    venue: "CVPR",
    status: "to_read",
    tags: ["contrastive", "self-supervised", "cnn"],
    arxiv_id: "1911.05722",
    summary: "Dictionary queue for contrastive learning — pairs with ResNet backbone experiments.",
  },
  {
    title: T.infogan,
    authors: ["Xi Chen", "Yan Duan", "Rein Houthooft", "John Schulman", "Ilya Sutskever", "Pieter Abbeel"],
    year: 2016,
    venue: "NeurIPS",
    status: "skimmed",
    rating: 3,
    tags: ["gan", "disentanglement", "latent-variables"],
    arxiv_id: "1606.03657",
    summary: "Mutual-information disentanglement in GANs — contrast with VAE-based approaches.",
  },
  {
    title: T.ours,
    authors: ["Test PhD C"],
    year: 2026,
    status: "skimmed",
    tags: ["thesis", "graph-prior", "vae", "disentanglement"],
    summary: "Internal draft outlining our contribution — keep synced with report Ch. 3–4.",
  },
  {
    title: T.cvae,
    authors: ["Kihyuk Sohn", "Honglak Lee", "Xinchen Yan"],
    year: 2015,
    venue: "NeurIPS",
    status: "read",
    rating: 3,
    readDaysAgo: 60,
    tags: ["vae", "conditional", "latent-variables"],
    summary: "Conditional VAE — the conditioning path is what we replace with a graph prior.",
  },
  {
    title: T.iwae,
    authors: ["Yuri Burda", "Roger Grosse", "Ruslan Salakhutdinov"],
    year: 2016,
    venue: "ICLR",
    status: "read",
    rating: 4,
    readDaysAgo: 45,
    arxiv_id: "1509.00519",
    tags: ["vae", "latent-variables", "inference"],
    summary: "Tighter bound via importance sampling. Used k=5 for the held-out likelihood numbers in exp-05.",
  },
  {
    title: T.tcvae,
    authors: ["Ricky T. Q. Chen", "Xuechen Li", "Roger Grosse", "David Duvenaud"],
    year: 2018,
    venue: "NeurIPS",
    status: "read",
    rating: 5,
    readDaysAgo: 40,
    arxiv_id: "1802.04942",
    tags: ["vae", "disentanglement", "latent-variables"],
    summary: "Decomposes the KL into index-code MI, total correlation, dimension-wise KL. Defines the **MIG** metric we report.",
  },
  {
    title: T.dipVae,
    authors: ["Abhishek Kumar", "Prasanna Sattigeri", "Avinash Balakrishnan"],
    year: 2018,
    venue: "ICLR",
    status: "skimmed",
    rating: 3,
    arxiv_id: "1711.00848",
    tags: ["vae", "disentanglement"],
    summary: "Moment-matching penalty on the aggregate posterior — one more point on the β/TC axis for Table 2.",
  },
  {
    title: T.ladder,
    authors: ["Casper Kaae Sønderby", "Tapani Raiko", "Lars Maaløe", "Søren Kaae Sønderby", "Ole Winther"],
    year: 2016,
    venue: "NeurIPS",
    status: "skimmed",
    arxiv_id: "1602.02282",
    tags: ["vae", "hierarchical", "latent-variables"],
    summary: "Hierarchical latents with top-down inference — candidate for a deeper prior if time allows.",
  },
  {
    title: T.adam,
    authors: ["Diederik P. Kingma", "Jimmy Ba"],
    year: 2015,
    venue: "ICLR",
    status: "read",
    rating: 4,
    readDaysAgo: 200,
    arxiv_id: "1412.6980",
    tags: ["optimisation", "foundations"],
    summary: "Optimiser for every run. lr 1e-3, β₁ 0.9, β₂ 0.999 unless stated.",
  },
  {
    title: T.batchnorm,
    authors: ["Sergey Ioffe", "Christian Szegedy"],
    year: 2015,
    venue: "ICML",
    status: "read",
    rating: 3,
    readDaysAgo: 210,
    arxiv_id: "1502.03167",
    tags: ["cnn", "optimisation", "foundations"],
    summary: "Used in the ResNet encoder; disabled in the decoder after it hurt reconstruction (exp-02 note).",
  },
  {
    title: T.dropout,
    authors: ["Nitish Srivastava", "Geoffrey Hinton", "Alex Krizhevsky", "Ilya Sutskever", "Ruslan Salakhutdinov"],
    year: 2014,
    venue: "JMLR",
    status: "skimmed",
    tags: ["regularisation", "foundations"],
    summary: "Background only. Not used — KL already regularises the latent.",
  },
  {
    title: T.graphsage,
    authors: ["William L. Hamilton", "Rex Ying", "Jure Leskovec"],
    year: 2017,
    venue: "NeurIPS",
    status: "read",
    rating: 4,
    readDaysAgo: 55,
    arxiv_id: "1706.02216",
    tags: ["gnn", "graph-prior", "inductive"],
    summary: "Neighbourhood sampling makes the graph encoder inductive — needed so unseen papers get a latent.",
  },
  {
    title: T.gin,
    authors: ["Keyulu Xu", "Weihua Hu", "Jure Leskovec", "Stefanie Jegelka"],
    year: 2019,
    venue: "ICLR",
    status: "read",
    rating: 4,
    readDaysAgo: 30,
    arxiv_id: "1810.00826",
    tags: ["gnn", "foundations", "graph-prior"],
    summary: "WL-test expressiveness bound. Justifies sum aggregation in the graph-prior module (§3.2).",
  },
  {
    title: T.dgi,
    authors: ["Petar Veličković", "William Fedus", "William L. Hamilton", "Pietro Liò", "Yoshua Bengio", "R Devon Hjelm"],
    year: 2019,
    venue: "ICLR",
    status: "reading",
    arxiv_id: "1809.10341",
    tags: ["gnn", "self-supervised", "contrastive"],
    summary: "Mutual-information objective on graphs — bridge between the contrastive and graph clusters.",
  },
  {
    title: T.sde,
    authors: ["Yang Song", "Jascha Sohl-Dickstein", "Diederik P. Kingma", "Abhishek Kumar", "Stefano Ermon", "Ben Poole"],
    year: 2021,
    venue: "ICLR",
    status: "to_read",
    arxiv_id: "2011.13456",
    tags: ["diffusion", "generative"],
    summary: "Unifies score matching and diffusion — only for the related-work paragraph on non-VAE generative models.",
  },
  {
    title: T.dsprites,
    authors: ["Loïc Matthey", "Irina Higgins", "Demis Hassabis", "Alexander Lerchner"],
    year: 2017,
    status: "read",
    rating: 4,
    readDaysAgo: 95,
    url: "https://github.com/deepmind/dsprites-dataset",
    tags: ["dataset", "disentanglement"],
    summary: "The benchmark. 737,280 binary 64×64 images from 6 ground-truth factors. Every experiment here runs on it.",
  },
  {
    title: T.eastwood,
    authors: ["Cian Eastwood", "Christopher K. I. Williams"],
    year: 2018,
    venue: "ICLR",
    status: "read",
    rating: 4,
    readDaysAgo: 35,
    tags: ["disentanglement", "evaluation"],
    summary: "Disentanglement / completeness / informativeness (DCI). Reported next to MIG in every results table.",
  },
  {
    title: T.byol,
    authors: ["Jean-Bastien Grill", "Florian Strub", "Florent Altché", "et al."],
    year: 2020,
    venue: "NeurIPS",
    status: "to_read",
    arxiv_id: "2006.07733",
    tags: ["contrastive", "self-supervised", "representation-learning"],
    summary: "Contrastive learning without negatives — parked with SimCLR/MoCo as an encoder-init option.",
  },
  {
    title: T.flows,
    authors: ["Ivan Kobyzev", "Simon J.D. Prince", "Marcus A. Brubaker"],
    year: 2020,
    venue: "IEEE TPAMI",
    status: "skimmed",
    rating: 3,
    arxiv_id: "1908.09257",
    tags: ["generative", "survey", "latent-variables"],
    summary: "Survey. A flow posterior is the obvious 'future work' for a tighter bound — one paragraph in Ch. 6.",
  },
];

/** Dense enough that the default cites-only graph view shows structure. */
export const SHOWCASE_RELATIONS: ShowcaseRelationRow[] = [
  [T.ours, T.betaVae, "extends", "Graph prior generalises β-VAE"],
  [T.ours, T.vgae, "builds_on"],
  [T.ours, T.locatello, "cites", "Inductive bias argument"],
  [T.ours, T.gnnSurvey, "cites"],
  [T.ours, T.vgae, "cites"],
  [T.ours, T.vae, "cites"],
  [T.ours, T.tcvae, "uses_method", "MIG metric"],
  [T.ours, T.eastwood, "uses_method", "DCI metric"],
  [T.ours, T.dsprites, "uses_method", "Benchmark"],
  [T.ours, T.gin, "uses_method", "Sum aggregation"],
  [T.ours, T.graphsage, "builds_on", "Inductive encoder"],
  [T.betaVae, T.vae, "extends"],
  [T.betaVae, T.factorVae, "cites"],
  [T.betaVae, T.dsprites, "uses_method"],
  [T.factorVae, T.betaVae, "extends"],
  [T.factorVae, T.vae, "builds_on"],
  [T.factorVae, T.locatello, "cites"],
  [T.tcvae, T.betaVae, "extends", "Decomposes the β penalty"],
  [T.tcvae, T.factorVae, "similar", "Both penalise total correlation"],
  [T.tcvae, T.vae, "builds_on"],
  [T.dipVae, T.betaVae, "similar"],
  [T.dipVae, T.vae, "extends"],
  [T.eastwood, T.betaVae, "cites"],
  [T.eastwood, T.infogan, "cites"],
  [T.eastwood, T.dsprites, "uses_method"],
  [T.vqVae, T.vae, "extends"],
  [T.vqVae, T.resnet, "uses_method"],
  [T.vqVae, T.gan, "cites"],
  [T.cvae, T.vae, "extends"],
  [T.iwae, T.vae, "extends", "Tighter bound"],
  [T.ladder, T.vae, "extends"],
  [T.ladder, T.batchnorm, "uses_method"],
  [T.locatello, T.betaVae, "contradicts", "No free disentanglement"],
  [T.locatello, T.factorVae, "cites"],
  [T.locatello, T.tcvae, "cites"],
  [T.locatello, T.dipVae, "cites"],
  [T.locatello, T.dsprites, "uses_method"],
  [T.infogan, T.gan, "extends"],
  [T.infogan, T.betaVae, "similar"],
  [T.ddpm, T.vae, "similar"],
  [T.ddpm, T.gan, "similar"],
  [T.sde, T.ddpm, "extends"],
  [T.flows, T.vae, "cites"],
  [T.flows, T.ddpm, "cites"],
  [T.gat, T.attention, "uses_method"],
  [T.gat, T.gcn, "extends"],
  [T.gat, T.battaglia, "cites"],
  [T.vgae, T.vae, "extends"],
  [T.vgae, T.gcn, "uses_method"],
  [T.vgae, T.gat, "cites"],
  [T.nri, T.vgae, "similar"],
  [T.nri, T.gat, "uses_method"],
  [T.nri, T.battaglia, "cites"],
  [T.battaglia, T.gcn, "cites"],
  [T.battaglia, T.gat, "cites"],
  [T.graphsage, T.gcn, "extends", "Inductive, sampled neighbourhoods"],
  [T.gin, T.gcn, "contradicts", "Mean aggregation loses expressiveness"],
  [T.gin, T.graphsage, "cites"],
  [T.dgi, T.gcn, "uses_method"],
  [T.dgi, T.graphsage, "cites"],
  [T.dgi, T.simclr, "similar", "MI objective"],
  [T.gnnSurvey, T.battaglia, "cites"],
  [T.gnnSurvey, T.gin, "cites"],
  [T.gnnSurvey, T.graphsage, "cites"],
  [T.vaeSurvey, T.vae, "cites"],
  [T.vaeSurvey, T.betaVae, "cites"],
  [T.vaeSurvey, T.iwae, "cites"],
  [T.vaeSurvey, T.ladder, "cites"],
  [T.simclr, T.moco, "similar"],
  [T.simclr, T.resnet, "uses_method"],
  [T.moco, T.resnet, "uses_method"],
  [T.moco, T.simclr, "cites"],
  [T.byol, T.simclr, "extends", "Drops the negatives"],
  [T.byol, T.moco, "cites"],
  [T.attention, T.gnnSurvey, "cites"],
  [T.resnet, T.batchnorm, "uses_method"],
  [T.resnet, T.adam, "cites"],
  [T.batchnorm, T.dropout, "cites"],
  [T.gcn, T.battaglia, "cites"],
  [T.gcn, T.adam, "uses_method"],
];

export const SHOWCASE_PAPER_FIGURES: Record<string, ShowcaseFigure[]> = {
  [T.attention]: [["attention-arch", "Transformer encoder block"]],
  [T.resnet]: [["resnet-block", "Residual skip connection"]],
  [T.vqVae]: [["vqvae-codebook", "Vector quantisation codebook"]],
  [T.betaVae]: [
    ["beta-vae-heatmap", "Latent factor traversals"],
    ["beta-sweep-bar", "β vs reconstruction / disentanglement"],
  ],
  [T.gnnSurvey]: [["gnn-graph", "Graph neighbourhood"]],
  [T.ours]: [["method-overview", "Proposed pipeline"]],
};

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
