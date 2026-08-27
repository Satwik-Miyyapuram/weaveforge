# What to build next, and why — market read, August 2026

A scan of what the tools around us shipped, what their users complain about in
public, and where that leaves WeaveForge. Sources at the end. Every claim about
a competitor is somebody else's writing, not a measurement of ours.

## The one-paragraph read

The reference-manager incumbent has publicly declined to build AI into the
product and pushed it to plugins, and its users are unhappy about the resulting
fragmentation. The LaTeX incumbent has no AI, a weak bibliography checker and a
compile-time ceiling on the free tier. The AI-research tools that are winning
(Elicit, Undermind, NotebookLM) are cloud-only and own none of your writing.
Local-first went from a niche argument to a track at FOSDEM. Nobody in this
market ties *the papers you read*, *the thing you are writing*, *the runs you
trained* and *the person supervising you* into one thing that works on a train.
That is the gap we already sit in; the work is to make the tie-in undeniable.

## What the neighbours are doing

| Tool | What it does well | Where its users say it hurts |
| --- | --- | --- |
| Zotero 8/9 | The library. Unified citation dialog, notes in tabs, faster releases (6–10 weeks), read-aloud | No native AI **by policy** — plugins only. Users report ~50 competing AI plugins appearing in weeks, plugin rot, and some plugins rewriting Zotero's SQLite |
| Obsidian | Local files, links, a graph, plugin depth | Steep setup, no real-time collaboration, no built-in cloud, weak mobile. The 2024–26 trend is AI plugins that keep data local |
| Overleaf | Everyone's shared LaTeX | Free-tier compile timeouts on big or image-heavy theses, no AI assistance, bibliography checking weaker than dedicated tools, collaborator caps |
| Elicit / Undermind / Consensus | Screening and citation-grounded search at scale (Elicit: 138M papers) | Cloud-only, per-seat, and they hold neither your draft nor your data |
| NotebookLM | Source-grounded answers, mind maps, and since Nov 2025 an agentic "Deep Research" mode | Cloud, Google-account, reported to struggle past ~100 documents |
| Anytype / Capacities / Heptabase | Local-first or object-model PKM, polished | General-purpose. No papers, no LaTeX, no runs, no supervisor |
| Rayyan / Colandr / ASReview | Systematic-review screening; Colandr free and open, ASReview active learning | PRISMA export behind Rayyan's paid tier; none of them is where you then write |
| W&B / MLflow / Neptune | Experiment tracking, now with LLM and agent features | A silo away from the thesis — which is the whole reason we mirror into W&B rather than compete with it |

## Where we already differ

Worth being clear about, because it decides what is worth building:

- One database holds papers, notes, plan, report, logbook and runs. Everyone
  else federates two or three products with plugins.
- It runs with no account at all, on a machine with no network — the local-first
  argument actually shipped, not a roadmap item.
- The AI surface is proposal-gated: nothing is written without review. That is
  an answer to the "how do I document AI's contribution" worry researchers raise
  in the Zotero thread.
- Student and supervisor is a first-class relationship. Nothing else in this
  scan has one.

## What to build, ranked

Ranked by value against effort, and by whether it survives the network being
unplugged — which is the thing we can claim and they cannot.

### 1. Bibliography validation before you submit — small, offline, obvious

The complaint is specific: Overleaf's built-in checker misses missing required
BibTeX fields, duplicate citation keys, malformed DOIs and URLs, inconsistent
author formatting. We already parse the LaTeX and already hold the library, so
we can also answer the two questions Overleaf cannot: **which `\cite` keys have
no entry**, and **which library entries the draft never cites**. Pure functions
in `core`, no network, no model. The cheapest credible win on this list.

### 2. Screening states and a PRISMA count — medium, and it uses supervision

Reading lists become a screening pipeline: include / exclude / unsure, with a
reason, per reviewer. We already have a second person (supervisor or
collaborator), so inter-rater agreement is nearly free, and the PRISMA numbers
— identified, screened, eligible, included — fall out of the states. Export them
as a LaTeX figure straight into the linked report. Rayyan charges for the
diagram; ours would be a by-product of data we already keep.

### 3. Semantic search that never leaves the machine — larger, and it is the moat

Zotero has ruled out native AI, and its users are asking for exactly this, with
"privacy-first, locally-processed models as defaults" named in that thread. A
small embedding model in the desktop shell, vectors in the local database,
`search_workspace` ranking by meaning rather than by word. It works with no
account, which no cloud competitor can match, and it makes the MCP tools sharply
better the day it lands.

### 4. Annotation import from the Zotero already running here — medium

We proxy Zotero's local API already. Importing highlights and notes — with their
colours, which is how the documented workflows encode meaning — turns a paper
row into a literature note without the plugin fragility people describe.

### 5. A wider MCP surface — medium, high leverage

Agent-driven library work is where the attention is (ZotPilot and friends).
Ours is the only MCP server that could answer "what did I claim in chapter 3,
which run supports it, and which paper did I get it from". Add the experiment
and report tools; keep every write behind the proposal gate.

### 6. Compile locally — optional, desktop-only

The free-tier compile timeout is a real, named pain. A desktop copy that finds a
local TeX installation could compile with no queue and no ceiling.
Detection-based, silent when absent, and honest that it is not us competing with
Overleaf's collaboration.

### Explicitly not doing

- **A chat-with-your-PDF box.** Fifty plugins already do it, and it is the
  feature most likely to write something into a thesis nobody checked.
- **Competing with W&B.** We mirror into it. A lab that watches W&B keeps
  watching W&B.
- **Cloud-only anything.** Every item above has to answer "and offline?".

## Sources

- [Zotero forums — AI "elephant in the room"](https://forums.zotero.org/discussion/132016/ai-elephant-in-the-room-what-is-zotero-s-strategy)
- [Announcing Zotero 8](https://forums.zotero.org/discussion/129152/announcing-zotero-8)
- [Zotero 8, January 2026 (Information Literacy Toolkit)](https://www.werkzeugkasten-ik.ch/en/2026/05/08/zotero-8-january-2026/)
- [Overleaf alternatives 2026](https://trybibby.com/blog/overleaf-alternative-2026)
- [Obsidian review 2026](https://www.lindy.ai/blog/obsidian-review), [Obsidian on Reddit, 2026 round-up](https://www.aitooldiscovery.com/guides/obsidian-reddit)
- [Elicit vs SciSpace](https://paperguide.ai/blog/elicit-vs-scispace/), [AI research assistants 2026](https://researcher.life/blog/article/best-ai-research-assistants/)
- [NotebookLM competitors 2026](https://www.atlasworkspace.ai/blog/notebooklm-competitors), [NotebookLM evolution 2023–2026](https://medium.com/@jimmisound/the-cognitive-engine-a-comprehensive-analysis-of-notebooklms-evolution-2023-2026-90b7a7c2df36)
- [FOSDEM 2026 local-first track](https://fosdem.org/2026/schedule/track/local-first/), [Local-first software in 2026](https://verity.salient.community/research/local-first-software-in-2026.html)
- [Rayyan alternatives 2026](https://ponder.ing/blog/rayyan-alternatives), [AI tools for systematic review 2026](https://paperguide.ai/blog/ai-tools-for-systematic-review/)
- [Zotero MCP](https://github.com/54yyyu/zotero-mcp), [ZotPilot announcement](https://forums.zotero.org/discussion/130483/zotpilot-mcp-server-for-semantic-search-classification-and-literature-review-drafting-from-your-z)
- [W&B vs MLflow vs Neptune 2026](https://www.index.dev/skill-vs-skill/ai-wandb-vs-mlflow-vs-neptune)

Reddit itself is not crawlable by this agent — the site blocks it — so the
community sentiment above is second-hand: round-ups that quote threads, and
vendor forums where users post under their own names. Treat the Zotero forum
links as the primary ones; those are researchers writing directly.
