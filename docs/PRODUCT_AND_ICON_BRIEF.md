# WeaveForge — Product and Icon Brief

## One-sentence description

**WeaveForge is a private research workspace that brings a thesis's
literature, notes, plan, experiments, writing outline, and collaboration into
one connected place.**

It is not just a task manager, reference manager, note app, or experiment
tracker. It is the working environment around a long research project: the
place where a paper becomes a note, a note becomes a plan, a plan becomes an
experiment, and an experiment becomes part of the thesis.

## The problem it solves

Doing a thesis normally scatters work across several disconnected tools:

- Zotero for papers and annotations.
- Notion, Obsidian, or loose documents for notes.
- A calendar or task app for milestones.
- Git, W&B, TensorBoard, or folders for experiments.
- Google Docs or Word for the report.
- Messages and screenshots for supervision.

WeaveForge connects those pieces without pretending it replaces the tools
that already do their specialist jobs well. Zotero remains the bibliographic
authority; Git remains the code history; training scripts can still create
experiments. WeaveForge is the **research map** that connects them.

## Who it is for

The primary user is a Master's or PhD researcher working over months or years.
It also supports a small lab: supervisors can see relevant progress, students
can share work deliberately, and collaborators can comment or co-edit when
granted access. A researcher can use it completely standalone as well.

The product should feel calm, serious, personal, and trustworthy—not like a
corporate project dashboard or an autonomous AI agent.

## The core mental model

Think of WeaveForge as a **connected research desk** with seven related
areas:

| Area | What it holds | Why it matters |
| --- | --- | --- |
| Library | Papers, metadata, tags, links, summaries, Zotero notes and annotations | What the researcher has read or needs to read |
| Graph and lists | Citation relations, concept/tag connections, nested reading lists | How the literature fits together |
| Notes | Paper notes and a wiki-style vault | What the researcher thinks about the material |
| Plan and logbook | Milestones, dependencies, progress, daily/weekly reflections | What needs to happen and what actually happened |
| Experiments | Runs, metrics, artifacts, Git branches and commits | What was tried and what the results mean |
| Report | A nested outline, status, word targets, and progress | How the research becomes a thesis |
| People and sharing | Lab structure, supervisor visibility, comments, shares, and pins | How work is discussed without losing ownership |

These are not isolated pages. A paper can be in a reading list, linked in the
graph, used by an experiment, mentioned in a log entry, and connected to a
report section. That connectedness is the product's central idea.

## Main user journey

1. A researcher creates a project for a thesis.
2. They import papers from a URL, DOI, arXiv, or Zotero.
3. They organise papers into nested reading lists and explore their citation
   and tag graph.
4. They keep notes beside papers, store longer thinking in a vault, and record
   progress in a logbook.
5. They plan milestones and run experiments tied to their code and results.
6. They build a report outline that shows how much of the thesis is drafted.
7. They selectively share real objects with supervisors or collaborators rather
   than sending screenshots or separate documents.

## Privacy is part of the product identity

Privacy is not a small settings feature. It is one of the reasons the product
exists.

- Workspace content is end-to-end encrypted: the backend stores ciphertext,
  while an unlocked client holds the keys needed to read it.
- Sharing is deliberate and scoped to resources or resource types.
- External integration credentials, such as a Zotero key, are encrypted in the
  client and used directly with the provider rather than relayed through the
  WeaveForge server.
- PDFs are not stored by WeaveForge. Zotero and ZotMoov manage the source
  files; WeaveForge works with metadata, notes, and annotations the user
  chooses to sync.
- The AI/MCP connection is opt-in, source-scoped, time-bounded, and revocable.
  It only sees selected material while the browser is unlocked. AI actions are
  proposals for the user to review, never silent writes.

An icon should therefore suggest **ownership, focus, and connection**, not
surveillance, cloud extraction, or an all-seeing AI.

## Technical character, in plain language

WeaveForge is a self-hostable web app and PWA, with a companion Python SDK
for logging research experiments from code. It integrates with Zotero, Git,
GitLab/GitHub, Mattermost, Semantic Scholar, and common ML experiment sources.

Internally it is modular: the research workflow is designed to grow without
turning into one large, fragile system. This supports the product metaphor of a
well-organised research workspace rather than a pile of unrelated utilities.

## Brand personality

The visual identity should balance these qualities:

| Quality | Meaning in the icon |
| --- | --- |
| Scholarly | Knowledge, reading, inquiry, careful thought |
| Connected | Papers, ideas, experiments, and writing form a graph |
| Grounded | A thesis is built steadily over time, not generated instantly |
| Private | Personal ownership, a protected workspace, trust |
| Modern | Works as a clean app/PWA icon, not a university crest |
| Human | Supportive and thoughtful; not cold enterprise software |

## Icon territory: the strongest concept

### Recommended direction: a connected thesis page

Create a simple, rounded **document/page** shape as the central form. Inside
or around it, add a small constellation of three connected nodes or a subtle
branching line. The document represents the thesis; the connected points
represent the living research system behind it: papers, notes, experiments,
and ideas.

This is stronger than a generic book because it communicates both the final
written thesis and the connections that create it.

Possible construction:

```text
      ●
     ╱ ╲
  ┌─────────┐
  │  ── ●   │
  │   ╲     │
  └─────────┘
```

Keep it abstract enough to read at 16–32 px. The graph should be a gesture,
not a dense network diagram.

## Alternative icon directions

### 1. The thesis path

A single line progresses through small milestone points and ends in a compact
page/book form. This stresses research as a journey from reading to writing.

Best if the product is framed primarily as a thesis companion and planner.

### 2. The protected knowledge graph

Three or four connected nodes form a soft shield, circle, or enclosing shape.
This stresses private, connected research.

Best if privacy and E2EE are central to the public launch message. Avoid making
the shield too literal or cybersecurity-like.

### 3. The research atlas

A folded-map or layered-card silhouette contains one or two connection lines.
This suggests navigation through a complex body of work.

Best if the graph, reading lists, and whole-project overview become the most
recognisable experience.

### 4. The annotated page

A page with one small margin mark, bookmark, or highlighted node. This makes
the icon feel intimate and research-specific, especially alongside Zotero
notes and report drafting.

Best as a quieter, more literary option.

## What to avoid

- A graduation cap: it implies the end ceremony, not the research process.
- A generic AI sparkle or chatbot: AI is optional and should not define the
  product.
- A plain clipboard/checkmark: this reduces the app to task management.
- A dense citation graph: it will collapse at app-icon size.
- A traditional academic crest, quill, or microscope: these become either too
  institutional or too discipline-specific.
- A lock as the main symbol: privacy matters, but the product is about doing
  research, not security software.
- Direct copying of Zotero, Obsidian, Notion, GitHub, or Google Scholar visual
  language.

## Colour and style direction

The existing product uses a restrained, warm paper-like light theme and a deep
ink/slate dark theme, with muted blue as a key action colour and gentle status
colours. The icon should work in both environments.

Suggested direction:

- **Primary:** deep ink/navy or charcoal, conveying concentration and trust.
- **Accent:** muted scholarly blue; optionally a small indigo/violet note for
  graph/AI access, but not a neon gradient.
- **Background:** warm off-white for light use; near-black/slate for dark use.
- **Form:** rounded, geometric, slightly soft—not overly playful.
- **Detail:** use a single-weight stroke or solid shapes, never both in a way
  that becomes noisy at small sizes.

For the app icon, make a one-colour version first. If it remains recognisable
in monochrome at 16 px, it is likely the right mark.

## Practical icon deliverables

When making the icon, create these versions from the same core mark:

1. App/PWA icon: square, no text, recognisable at 16–512 px.
2. Favicon: simplified one- or two-shape version.
3. Product mark: icon plus the words “WeaveForge”.
4. Light and dark variants.
5. Monochrome variant for documentation and print.

Test the symbol at 16 px, 32 px, 64 px, and 180 px. If the graph detail turns
into visual noise, reduce it to two nodes and one line.

## Short prompts for exploring icon concepts

### Recommended prompt

> Minimal app icon for “WeaveForge”, a private all-in-one research
> workspace for papers, notes, experiments, planning, and thesis writing. A
> rounded document/page shape combined with three small connected graph nodes,
> suggesting a thesis built from connected research. Calm scholarly modern
> design, deep ink navy and muted blue, warm off-white background, simple
> geometric vector style, no text, no graduation cap, no chatbot, no lock,
> readable at 16 pixels.

### Privacy-forward prompt

> Minimal vector app icon for a private research workspace. A small connected
> knowledge graph gently enclosed by a page-like or protective rounded form.
> Scholarly, calm, trustworthy, deep navy with muted indigo accent, no text,
> no literal shield, no AI sparkle, no dense network, crisp PWA icon.

### Literary prompt

> Minimal vector app icon for “WeaveForge”: an annotated thesis page or
> open notebook with one elegant connected-node line, expressing reading,
> thinking, experiments, and writing as one process. Warm academic editorial
> feel, ink blue and soft paper colour, modern geometric simplicity, no text.

## Final positioning line

**WeaveForge is the private, connected workspace where a thesis takes
shape.**
