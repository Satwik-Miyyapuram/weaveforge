import {
  ENTITY_DIRS,
  EXPERIMENT_STATUSES,
  LOG_KINDS,
  MILESTONE_STATUSES,
  PAPER_STATUSES,
  RELATION_TYPES,
  type WorkspaceEntityType,
} from "@weaveforge/core";

// The MCP tool catalogue: names, descriptions and input schemas.

export const KINDS = (Object.keys(ENTITY_DIRS) as WorkspaceEntityType[]).filter((kind) => kind !== "ink_page");
export const DEFAULT_PAGE_SPAN = 10;

const str = (description: string) => ({ type: "string", description });
const RATIONALE = str("Why, in a sentence or two. Shown to the person who approves it.");

const PROJECT = str("Project name or id (see list_projects). Reads: only that project. New entries: the project they go in, needed when there is more than one.");

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[] = [], scoped = true) {
  return { name, description, inputSchema: { type: "object", properties: scoped ? { ...properties, project: PROJECT } : properties, required } };
}

const DRAFT_NOTE = " Leaves a draft; nothing changes until a person approves it in WeaveForge.";

export const TOOLS = [
  tool("list_projects", "List the projects: name, id, folder and what each holds. Start here, then pass project to the other tools.", {}, [], false),
  tool("search_workspace", `Search the workspace folder for text. Optionally restrict to one kind: ${KINDS.join(", ")}.`, {
    query: str("Text to look for, case-insensitive."),
    kind: { type: "string", enum: KINDS, description: "Restrict to one kind of entry." },
  }, ["query"]),
  tool("list_workspace", "List the entries of one kind: title, id, path and status.", {
    kind: { type: "string", enum: KINDS },
  }, ["kind"]),
  tool("read_entry", "Read one file from the workspace folder, by its path.", { path: str("Path inside the folder.") }, ["path"], false),
  tool("get_note", "Read one note, by its id or title.", { note: str("The note's id, or its title.") }, ["note"]),
  tool("get_paper", "Read one paper's entry and say whether its PDF is on disk.", { paper: str("The paper's id, or its title.") }, ["paper"]),
  tool("get_paper_text", `Read a paper's PDF text, by page (1-based, up to ${DEFAULT_PAGE_SPAN} pages at a time). Needs the paper opened once in WeaveForge.`, {
    paper: str("The paper's id, or its title."),
    fromPage: { type: "integer", minimum: 1 },
    toPage: { type: "integer", minimum: 1 },
  }, ["paper"]),
  tool("get_report_section", "Read one report section, by its id or title.", { section: str("The section's id, or its title.") }, ["section"]),
  tool("get_experiment", "Read one experiment, by its id or title.", { experiment: str("The experiment's id, or its title.") }, ["experiment"]),
  tool("list_experiments", "List the experiments in the workspace folder.", {}),
  tool("get_milestone", "Read one plan milestone, by its id or title.", { milestone: str("The milestone's id, or its title.") }, ["milestone"]),
  tool("get_log", "Read one logbook entry, by its id or its date (YYYY-MM-DD).", { entry: str("The entry's id or date.") }, ["entry"]),
  tool("get_reading_list", "Read one reading list and the papers and notes in it.", { list: str("The list's id, or its title.") }, ["list"]),
  tool("list_tags", "List the tags in the workspace.", {}),
  tool("get_relations", "List links between papers, optionally only those touching one paper.", { paper: str("Optional paper id or title.") }),
  tool("get_backlinks", "For one note or paper: the [[links]] in it, the notes that link to it, and (papers) its relations.", {
    entry: str("The note's or paper's id, or its title."),
  }, ["entry"]),
  tool("suggest_note_create", `Suggest a new note.${DRAFT_NOTE}`, {
    title: str("The note's title."), body: str("Markdown body."), parent: str("Optional parent note id or title."), rationale: RATIONALE,
  }, ["title", "body"]),
  tool("suggest_note_edit", `Suggest a new title or body for a note.${DRAFT_NOTE}`, {
    note: str("The note's id, or its title."), title: str("New title."), body: str("New full markdown body."), rationale: RATIONALE,
  }, ["note"]),
  tool("suggest_note_append", `Suggest text to add to the end of a note.${DRAFT_NOTE}`, {
    note: str("The note's id, or its title."), addition: str("Markdown to append."), rationale: RATIONALE,
  }, ["note", "addition"]),
  tool("suggest_log_entry", `Suggest a logbook entry.${DRAFT_NOTE}`, {
    body: str("Markdown body."), entryDate: str("YYYY-MM-DD, default today."), kind: { type: "string", enum: LOG_KINDS }, rationale: RATIONALE,
  }, ["body"]),
  tool("suggest_milestone", `Suggest a new plan milestone.${DRAFT_NOTE}`, {
    title: str("Milestone title."), description: str("Optional description."), status: { type: "string", enum: MILESTONE_STATUSES },
    targetDate: str("YYYY-MM-DD."), rationale: RATIONALE,
  }, ["title"]),
  tool("suggest_milestone_status", `Suggest a status for a plan milestone.${DRAFT_NOTE}`, {
    milestone: str("The milestone's id, or its title."), status: { type: "string", enum: MILESTONE_STATUSES }, rationale: RATIONALE,
  }, ["milestone", "status"]),
  tool("suggest_experiment", `Suggest a new experiment.${DRAFT_NOTE}`, {
    name: str("Experiment name."), hypothesis: str("Optional hypothesis."), status: { type: "string", enum: EXPERIMENT_STATUSES }, rationale: RATIONALE,
  }, ["name"]),
  tool("suggest_experiment_update", `Suggest a status, metrics or artifacts for an experiment.${DRAFT_NOTE}`, {
    experiment: str("The experiment's id, or its title."), status: { type: "string", enum: EXPERIMENT_STATUSES },
    metrics: { type: "object", description: "Metric name to number." }, artifacts: { type: "array", items: { type: "string" } }, rationale: RATIONALE,
  }, ["experiment"]),
  tool("suggest_paper_update", `Suggest a paper's reading status, rating or tags.${DRAFT_NOTE}`, {
    paper: str("The paper's id, or its title."), status: { type: "string", enum: PAPER_STATUSES },
    rating: { type: "integer", minimum: 0, maximum: 5 }, tags: { type: "array", items: { type: "string" } }, rationale: RATIONALE,
  }, ["paper"]),
  tool("suggest_paper_note", `Suggest text to add to a paper's notes.${DRAFT_NOTE}`, {
    paper: str("The paper's id, or its title."), addition: str("Markdown to append."), rationale: RATIONALE,
  }, ["paper", "addition"]),
  tool("suggest_annotation", `Suggest a highlight on a paper's PDF, anchored by an exact quote.${DRAFT_NOTE}`, {
    paper: str("The paper's id, or its title."), quote: str("Exact text from the PDF."), comment: str("Optional comment."),
    page: { type: "integer", minimum: 1, description: "1-based page, if known." }, rationale: RATIONALE,
  }, ["paper", "quote"]),
  tool("suggest_relation", `Suggest a link between two papers.${DRAFT_NOTE}`, {
    from: str("Paper id or title."), to: str("Paper id or title."), relation: { type: "string", enum: RELATION_TYPES }, rationale: RATIONALE,
  }, ["from", "to", "relation"]),
  tool("suggest_reading_list_change", `Suggest adding a paper or note to a reading list.${DRAFT_NOTE}`, {
    list: str("The list's id, or its title."), paper: str("Paper id or title."), note: str("Note id or title."),
    comment: str("Why it belongs in the list."), rationale: RATIONALE,
  }, ["list"]),
  tool("suggest_report_edit", `Suggest new notes for a report section.${DRAFT_NOTE}`, {
    section: str("The section's id, or its title."), notes: str("The suggested text."), rationale: RATIONALE,
  }, ["section", "notes"]),
];

/** What an agent needs to log runs from code it writes; only for tokens that may log experiments. */
export interface TrackingSetup {
  /** The local API the Python SDK talks to. */
  apiUrl: string;
  /** The file Connect wrote; the SDK reads the token from it, so the token never enters code. */
  tokenFile: string;
  /** Project names to pass as WEAVEFORGE_PROJECT. */
  projects: () => Promise<string[]>;
}

export const TRACKING_TOOL = tool(
  "experiment_tracking_setup",
  "How to log experiment runs, metrics and figures to WeaveForge from code you write: the Python SDK to install, the address, where the token is, and the project names. Call before adding tracking to a training script.",
  {},
  [],
  false,
);

export async function trackingSetup(setup: TrackingSetup): Promise<string> {
  const projects = await setup.projects();
  // The SDK looks in ~/.weaveforge/mcp.json unless told otherwise (WeaveForge Dev writes mcp-dev.json).
  const where = /[\\/]mcp\.json$/.test(setup.tokenFile)
    ? "so set nothing else"
    : `once WEAVEFORGE_MCP_FILE=${setup.tokenFile} is set`;
  return [
    "Log experiments to WeaveForge with its Python SDK (open source, PyPI: weaveforge).",
    "",
    "Install: pip install weaveforge",
    "Extras when the script uses them: weaveforge[figures] (matplotlib/plotly), weaveforge[tensorboard], weaveforge[wandb], weaveforge[lightning], weaveforge[keras], or weaveforge[all].",
    "",
    `The token is already on this computer in ${setup.tokenFile}. The SDK reads it and the address (${setup.apiUrl}) from there when WEAVEFORGE_TOKEN is unset, ${where}. Never copy the token into code, notebooks, logs or commits.`,
    "Pick the WeaveForge project the runs belong to: pass project=\"<name>\" to track(), or set WEAVEFORGE_PROJECT. WeaveForge must be running while the script logs.",
    "",
    projects.length
      ? `Projects: ${projects.map((name) => JSON.stringify(name)).join(", ")}.`
      : "There are no projects yet; runs without a project go to the default list.",
    "",
    "Example:",
    "```python",
    "from weaveforge import track",
    "",
    'with track("resnet18-baseline", project="<project name>", config={"lr": 3e-4, "epochs": 10}) as run:',
    "    for epoch in range(10):",
    "        train_loss, val_loss = train_one_epoch()",
    '        run.log_metrics({"train_loss": train_loss, "val_loss": val_loss}, step=epoch)',
    '    run.log_figure(fig, name="confusion-matrix")  # matplotlib or plotly; needs weaveforge[figures]',
    '    run.log_summary({"val_loss": val_loss})',
    "```",
    "Decorator form: @track_experiment(name=..., config=...) on a train(run, ...) function. Existing logs: track(..., sync={\"tensorboard\": \"runs/x\"}) or mirror=\"wandb\".",
    "Runs show up live under Experiments in WeaveForge.",
  ].join("\n");
}
