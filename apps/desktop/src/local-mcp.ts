import { randomUUID } from "node:crypto";

import {
  ENTITY_DIRS,
  EXPERIMENT_STATUSES,
  FOLDER_DRAFTS_DIR,
  LOG_KINDS,
  MILESTONE_STATUSES,
  PAPER_STATUSES,
  RELATION_TYPES,
  WORKSPACE_META_DIR,
  bodyLinksTo,
  canonicalAiToolName,
  entityDir,
  extractWikilinks,
  mcpReadResult,
  normalizeTitleKey,
  paperPdfPath,
  parseFolderDraft,
  parseWorkspaceFile,
  type AiProposalKind,
  type ParsedEntity,
  type UntrustedItem,
  type WorkspaceEntityType,
} from "@weaveforge/core";

import { searchVault, walkVault } from "./local-api";
import { pickProject, resolveProjects, type ProjectRef, type ProjectSource } from "./local-mcp-projects";
import type { VaultSession } from "./vault-handlers";
import { listVaultFiles, readVaultFile, statVaultFile, writeVaultFile } from "./vault-handlers";

// The folder as an MCP server: reads anything, and every write is a draft in
// .weaveforge/proposals/ that a person approves in the app. Results go through mcpReadResult.

/** JSON-RPC, the subset a streamable-HTTP MCP client actually sends. */
export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

const PROTOCOL_VERSION = "2025-06-18";

/** Reorders word-search hits best first; optional because the encoder lives in the window. */
export type SemanticRanker = (query: string, candidates: readonly string[]) => Promise<string[] | null>;

/** Apply a ranking, keeping anything it did not mention in its old place. */
function reorder<T extends { filename: string }>(hits: readonly T[], order: readonly string[]): T[] {
  const rank = new Map(order.map((name, index) => [name, index]));
  return [...hits].sort(
    (a, b) => (rank.get(a.filename) ?? order.length) - (rank.get(b.filename) ?? order.length),
  );
}

// ink_page shares notes/ with vault_page, so listing it separately would repeat every note.
const KINDS = (Object.keys(ENTITY_DIRS) as WorkspaceEntityType[]).filter((kind) => kind !== "ink_page");

const PDF_TEXT_DIR = `${WORKSPACE_META_DIR}/cache/pdf-text`;
const MAX_PAPER_TEXT_CHARS = 60_000;
const DEFAULT_PAGE_SPAN = 10;
const JUNK_FILES = new Set(["desktop.ini", ".ds_store", "thumbs.db"]);

const str = (description: string) => ({ type: "string", description });
const RATIONALE = str("Why, in a sentence or two. Shown to the person who approves it.");

const PROJECT = str("Project name or id (see list_projects). Reads: only that project. New entries: the project they go in, needed when there is more than one.");

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[] = [], scoped = true) {
  return { name, description, inputSchema: { type: "object", properties: scoped ? { ...properties, project: PROJECT } : properties, required } };
}

const DRAFT_NOTE = " Leaves a draft; nothing changes until a person approves it in WeaveForge.";

const TOOLS = [
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

const TRACKING_TOOL = tool(
  "experiment_tracking_setup",
  "How to log experiment runs, metrics and figures to WeaveForge from code you write: the Python SDK to install, the address, where the token is, and the project names. Call before adding tracking to a training script.",
  {},
  [],
  false,
);

async function trackingSetup(setup: TrackingSetup): Promise<string> {
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

function ok(id: JsonRpcResponse["id"], result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function err(id: JsonRpcResponse["id"], code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** A tool answer, fenced and bounded, in the shape MCP expects. */
function content(items: readonly UntrustedItem[]): unknown {
  const result = mcpReadResult(items);
  return {
    content: [{ type: "text", text: result.text }],
    _meta: { nonce: result.nonce, omitted: result.omitted, truncated: result.truncated },
  };
}

/** Sortable, filename-safe, and second-resolution, which is enough here. */
function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function hidden(path: string): boolean {
  return path.split("/").some((part) => part.startsWith(".") || JUNK_FILES.has(part.toLowerCase()));
}

async function readText(session: VaultSession, path: string): Promise<string | null> {
  const read = await readVaultFile(session, path);
  if (!read.ok) throw new Error(read.message);
  return read.value;
}

interface Entry extends ParsedEntity {
  raw: string;
  project: ProjectRef;
}

/** Every parsed entry of one kind in each project's own folder; junk and hidden files skipped. */
async function loadEntries(session: VaultSession, kind: WorkspaceEntityType, projects: readonly ProjectRef[]): Promise<Entry[]> {
  const entries: Entry[] = [];
  for (const project of projects) {
    const files: string[] = [];
    await walkVault(session, entityDir(kind, project.dir), files);
    for (const file of files) {
      if (!file.endsWith(".md") || hidden(file)) continue;
      const raw = await readText(session, file);
      const parsed = raw === null ? null : parseWorkspaceFile(file, raw);
      if (parsed && raw !== null && (parsed.type === kind || (kind === "vault_page" && parsed.type === "ink_page"))) {
        entries.push({ ...parsed, raw, project });
      }
    }
  }
  return entries;
}

const norm = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
const describe = (entry: Entry) => `${entry.title} (${entry.id ?? entry.path})`;
const named = (entry: Entry) => `${entry.title} (${entry.type === "paper" ? "paper" : "note"})`;

/** Id first, then exact title, then a unique partial title or path; two matches is a question back. */
function pick(entries: readonly Entry[], needle: unknown, what: string): Entry {
  const wanted = typeof needle === "string" ? norm(needle) : "";
  if (!wanted) throw new Error(`That needs a ${what} id or title.`);
  const byId = entries.find((entry) => entry.id?.toLowerCase() === wanted);
  if (byId) return byId;
  const exact = entries.filter((entry) => norm(entry.title) === wanted);
  const found = exact.length
    ? exact
    : entries.filter((entry) => norm(entry.title).includes(wanted) || entry.path.toLowerCase().includes(wanted));
  if (!found.length) throw new Error(`No ${what} matches '${wanted}'.`);
  if (found.length > 1) {
    const where = found.slice(0, 10).map((entry) => `${describe(entry)} in ${entry.project.name}`);
    throw new Error(`'${wanted}' matches ${found.length} of them: ${where.join("; ")}. Use the id or name the project.`);
  }
  return found[0] as Entry;
}

function idOf(entry: Entry): string {
  if (!entry.id) throw new Error(`${entry.path} has no weaveforge-id yet; open the folder in WeaveForge once so it gets one.`);
  return entry.id;
}

function field(entry: Entry, key: string): string | undefined {
  const value = entry.fields[key];
  return typeof value === "string" && value ? value : undefined;
}

async function readJsonArray(session: VaultSession, project: ProjectRef, name: string): Promise<Record<string, unknown>[]> {
  const raw = await readText(session, `${project.dir ? `${project.dir}/` : ""}${WORKSPACE_META_DIR}/${name}`);
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null) : [];
  } catch {
    return [];
  }
}

function text(params: Record<string, unknown>, key: string, required = false): string | undefined {
  const value = params[key];
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed && required) throw new Error(`${key} is required.`);
  return trimmed || undefined;
}

function oneOf<T extends string>(params: Record<string, unknown>, key: string, allowed: readonly T[], required = false): T | undefined {
  const value = text(params, key, required);
  if (value === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(value)) throw new Error(`${key} must be one of: ${allowed.join(", ")}.`);
  return value as T;
}

function kindOf(params: Record<string, unknown>): WorkspaceEntityType | null {
  const kind = params.kind;
  return typeof kind === "string" && (KINDS as string[]).includes(kind) ? (kind as WorkspaceEntityType) : null;
}

/** Page text from the reader's cache; one subfolder per project, so every one is looked in. */
async function cachedPages(session: VaultSession, paperId: string): Promise<{ pageIndex: number; text: string }[] | null> {
  const listed = await listVaultFiles(session, PDF_TEXT_DIR);
  if (!listed.ok) return null;
  for (const dir of listed.value) {
    if (dir.kind !== "dir") continue;
    const raw = await readText(session, `${dir.path}/${encodeURIComponent(paperId)}.json`);
    if (!raw) continue;
    try {
      const pages = (JSON.parse(raw) as { pages?: unknown }).pages;
      if (Array.isArray(pages)) return pages as { pageIndex: number; text: string }[];
    } catch {
      // A torn cache file is the same as none.
    }
  }
  return null;
}

interface Draft {
  kind: AiProposalKind;
  tool: string;
  resourceId: string;
  resourceType: WorkspaceEntityType | "reading_list_item" | "paper_relation";
  summary: string;
  payload: Record<string, unknown>;
  expectedRevision?: string;
  project?: ProjectRef;
  /** Titles for id fields, so the reviewer reads names, not ids. */
  shown?: Record<string, string>;
}

/** What the reviewer reads: the change itself, not just the agent's reason for it. */
function draftPreview(draft: Draft, rationale: string | undefined): string {
  const lines = [`**${draft.summary}**`];
  if (draft.project) lines.push("", `Project: ${draft.project.name}`);
  if (rationale) lines.push("", `Why: ${rationale}`);
  for (const [key, value] of Object.entries(draft.payload)) {
    const title = draft.shown?.[key];
    if (title !== undefined) {
      if (title) lines.push("", `${fieldLabel(key === "vaultPageId" ? "note" : key.replace(/Id$/, ""))}: ${title}`);
    } else if (typeof value === "string" && (PROSE_KEYS.has(key) || value.includes("\n"))) lines.push("", value);
    else if (key === "pageIndex" && typeof value === "number") lines.push("", `Page: ${value + 1}`);
    else lines.push("", `${fieldLabel(key)}: ${previewValue(value)}`);
  }
  return lines.join("\n");
}

/** Payload fields that are the draft's text itself, shown without a label. */
const PROSE_KEYS = new Set(["body", "notes", "text", "content"]);

function fieldLabel(key: string): string {
  const words = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function previewValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((item) => typeof item !== "object")) return value.length ? value.join(", ") : "none";
  return JSON.stringify(value);
}

/** Writes one draft file; checked with the same parser the app imports with. */
async function leaveDraft(session: VaultSession, params: Record<string, unknown>, draft: Draft): Promise<unknown> {
  const body = {
    kind: draft.kind,
    tool: draft.tool,
    resourceId: draft.resourceId,
    resourceType: draft.resourceType,
    content: draftPreview(draft, text(params, "rationale")),
    payload: draft.payload,
    ...(draft.expectedRevision ? { expectedRevision: draft.expectedRevision } : {}),
    ...(draft.project?.id ? { projectId: draft.project.id } : {}),
    createdAt: new Date().toISOString(),
  };
  const json = JSON.stringify(body, null, 2);
  if (!parseFolderDraft(json)) throw new Error("That suggestion is too large or incomplete to leave.");
  const at = `${FOLDER_DRAFTS_DIR}/${stamp()}--${draft.kind}--${randomUUID().slice(0, 8)}.json`;
  const written = await writeVaultFile(session, at, json);
  if (!written.ok) throw new Error(written.message);
  const where = draft.project ? ` in ${draft.project.name}` : "";
  return content([{ label: "draft", text: `Left${where} at ${at}. Nothing changes until a person approves it in WeaveForge.` }]);
}

async function callTool(
  session: VaultSession,
  rawName: string,
  params: Record<string, unknown>,
  rank?: SemanticRanker,
  projects?: ProjectSource,
): Promise<unknown> {
  const name = canonicalAiToolName(rawName);
  let resolved: Promise<ProjectRef[]> | undefined;
  const allProjects = () => (resolved ??= resolveProjects(session, projects));
  const scope = async () => {
    const all = await allProjects();
    return text(params, "project") ? [pickProject(all, params.project)] : all;
  };
  // Where a new entry goes: the named project, else the only one there is.
  const home = async () => {
    const all = await allProjects();
    if (text(params, "project")) return pickProject(all, params.project);
    if (all.length === 1) return all[0] as ProjectRef;
    throw new Error(`Name the project: ${all.map((p) => p.name).join(", ")}.`);
  };
  const entries = async (kind: WorkspaceEntityType, within?: ProjectRef) => loadEntries(session, kind, within ? [within] : await scope());
  const findOne = async (kind: WorkspaceEntityType, needle: unknown, what: string, within?: ProjectRef) =>
    pick(await entries(kind, within), needle, what);
  const placed = (entry: { project: ProjectRef; path: string }) => `${entry.project.name}: ${entry.path}`;
  const one = async (kind: WorkspaceEntityType, key: string, what: string) => {
    const entry = await findOne(kind, params[key], what);
    return content([{ label: placed(entry), text: entry.raw }]);
  };
  const papers = (within?: ProjectRef) => entries("paper", within);
  const relationLines = async (project: ProjectRef, focus: string | null) => {
    const titles = new Map((await papers(project)).map((entry) => [entry.id, entry.title]));
    const label = (id: unknown) => titles.get(String(id)) ?? String(id);
    return (await readJsonArray(session, project, "relations.json"))
      .filter((row) => !focus || row.fromPaper === focus || row.toPaper === focus)
      .map((row) => `${label(row.fromPaper)} —${String(row.relation)}→ ${label(row.toPaper)}`);
  };

  switch (name) {
    case "list_projects": {
      const lines = [];
      for (const project of await allProjects()) {
        const counts = [];
        for (const kind of KINDS) {
          const n = (await loadEntries(session, kind, [project])).length;
          if (n) counts.push(`${ENTITY_DIRS[kind]} ${n}`);
        }
        lines.push([project.name, project.id, project.dir || "(root)", counts.join(", ") || "empty"].filter(Boolean).join(" | "));
      }
      return content([{ label: "projects", text: lines.join("\n") }]);
    }
    case "search_workspace": {
      const query = text(params, "query", true) as string;
      const kind = kindOf(params);
      const hits = [];
      for (const project of await scope()) {
        const found = await searchVault(session, query, kind ? entityDir(kind, project.dir) : project.dir);
        hits.push(...found.map((hit) => ({ ...hit, project })));
      }
      const shown = hits.filter((hit) => !hidden(hit.filename) && !hit.filename.includes(`${WORKSPACE_META_DIR}/`));
      const ordered = rank ? await rank(query, shown.map((hit) => hit.filename)) : null;
      const ranked = ordered ? reorder(shown, ordered) : shown;
      return content(ranked.map((hit) => ({ label: placed({ project: hit.project, path: hit.filename }), text: hit.matches.map((m) => m.context).join("\n") })));
    }
    case "list_workspace":
    case "list_experiments": {
      const kind = name === "list_experiments" ? "experiment" : kindOf(params);
      if (!kind) throw new Error("That is not a kind this workspace keeps.");
      const scoped = await scope();
      const items = [];
      for (const project of scoped) {
        const lines = (await loadEntries(session, kind, [project])).map((entry) =>
          [entry.title, entry.id ?? "-", entry.path, field(entry, "status") ?? ""].filter(Boolean).join(" | "),
        );
        const label = scoped.length > 1 ? `${project.name} / ${ENTITY_DIRS[kind]}` : ENTITY_DIRS[kind];
        items.push({ label, text: lines.join("\n") || "(nothing yet)" });
      }
      return content(items);
    }
    case "read_entry": {
      const at = text(params, "path", true) as string;
      if (hidden(at) || at.split("/").includes(WORKSPACE_META_DIR)) throw new Error("That file is WeaveForge's own; use the other tools.");
      const dirs = (await allProjects()).map((p) => p.dir).filter(Boolean);
      if (dirs.length && !dirs.some((dir) => at.startsWith(`${dir}/`))) throw new Error("That path is in no project; see list_projects.");
      const read = await readText(session, at);
      if (read === null) throw new Error("No such file.");
      return content([{ label: at, text: read }]);
    }
    case "get_note":
      return one("vault_page", "note", "note");
    case "get_report_section":
      return one("report_section", "section", "report section");
    case "get_experiment":
      return one("experiment", "experiment", "experiment");
    case "get_milestone":
      return one("milestone", "milestone", "milestone");
    case "get_log": {
      const all = await entries("log_entry");
      const wanted = text(params, "entry", true) as string;
      const byDate = all.filter((entry) => field(entry, "entry-date") === wanted);
      const found = byDate.length ? byDate : [pick(all, wanted, "log entry")];
      return content(found.map((entry) => ({ label: placed(entry), text: entry.raw })));
    }
    case "get_paper": {
      const paper = pick(await papers(), params.paper, "paper");
      const pdf = paper.id ? paperPdfPath(paper.id, paper.project.dir) : null;
      const stat = pdf ? await statVaultFile(session, pdf) : null;
      const hasPdf = !!(stat?.ok && stat.value);
      return content([
        { label: placed(paper), text: paper.raw },
        { label: "pdf", text: hasPdf ? `PDF on disk at ${pdf}. Read it with get_paper_text.` : "No PDF on disk for this paper." },
      ]);
    }
    case "get_paper_text": {
      const paper = pick(await papers(), params.paper, "paper");
      const pages = await cachedPages(session, idOf(paper));
      if (!pages) throw new Error(`No text for '${paper.title}' yet. Open its PDF once in WeaveForge and try again.`);
      const from = Math.max(1, Math.floor(Number(params.fromPage) || 1));
      const to = Math.min(pages.length, Math.max(from, Math.floor(Number(params.toPage) || from + DEFAULT_PAGE_SPAN - 1)));
      let out = "";
      for (const page of pages.slice(from - 1, to)) {
        out += `--- page ${page.pageIndex + 1} ---\n${page.text}\n`;
        if (out.length > MAX_PAPER_TEXT_CHARS) break;
      }
      return content([{ label: `${paper.project.name}: ${paper.title}, pages ${from}-${to} of ${pages.length}`, text: out.slice(0, MAX_PAPER_TEXT_CHARS) || "(no text on those pages)" }]);
    }
    case "get_reading_list": {
      const list = await findOne("reading_list", params.list, "reading list");
      const listId = idOf(list);
      const [items, paperRows, noteRows] = await Promise.all([
        readJsonArray(session, list.project, "reading-list-items.json"),
        papers(list.project),
        entries("vault_page", list.project),
      ]);
      const titles = new Map([...paperRows, ...noteRows].map((entry) => [entry.id, entry.title]));
      const lines = items
        .filter((item) => item.listId === listId)
        .sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0))
        .map((item) => {
          const target = String(item.paperId ?? item.vaultPageId ?? "");
          const label = item.paperId ? "paper" : "note";
          return `- ${label}: ${titles.get(target) ?? target}${item.note ? ` — ${String(item.note)}` : ""}`;
        });
      return content([{ label: list.path, text: list.raw }, { label: "items", text: lines.join("\n") || "(empty)" }]);
    }
    case "list_tags": {
      const names = new Set<string>();
      for (const project of await scope()) {
        for (const tag of await readJsonArray(session, project, "tags.json")) if (tag.name) names.add(String(tag.name));
      }
      return content([{ label: "tags", text: [...names].join("\n") || "(no tags)" }]);
    }
    case "get_relations": {
      const focus = text(params, "paper") ? pick(await papers(), params.paper, "paper") : null;
      const lines = [];
      for (const project of focus ? [focus.project] : await scope()) {
        lines.push(...await relationLines(project, focus ? idOf(focus) : null));
      }
      return content([{ label: "relations", text: lines.join("\n") || "(none)" }]);
    }
    case "get_backlinks": {
      const entry = pick([...await entries("vault_page"), ...await papers()], params.entry, "note or paper");
      const near = [...await entries("vault_page", entry.project), ...await papers(entry.project)];
      const byTitle = new Map(near.map((e) => [normalizeTitleKey(e.title), e]));
      const out = [...new Set(extractWikilinks(entry.body).map((link) => {
        const hit = byTitle.get(normalizeTitleKey(link.target));
        return hit ? named(hit) : `${link.target} (no such note)`;
      }))];
      const key = normalizeTitleKey(entry.title);
      const into = near.filter((e) => e.path !== entry.path && bodyLinksTo(e.body, key)).map(named);
      const items = [
        { label: "Links out", text: out.join("\n") || "(none)" },
        { label: "Links here", text: into.join("\n") || "(none)" },
      ];
      if (entry.type === "paper") items.push({ label: "Relations", text: (await relationLines(entry.project, idOf(entry))).join("\n") || "(none)" });
      return content(items);
    }

    case "suggest_note_create": {
      const title = text(params, "title", true) as string;
      const body = typeof params.body === "string" ? params.body : "";
      const project = await home();
      const parentNote = text(params, "parent") ? await findOne("vault_page", params.parent, "note", project) : undefined;
      const parent = parentNote ? idOf(parentNote) : undefined;
      return leaveDraft(session, params, {
        kind: "create_vault_note", tool: name, resourceId: randomUUID(), resourceType: "vault_page", project,
        summary: `New note: ${title}`, payload: { title, body, ...(parent ? { parentId: parent } : {}) },
        shown: parentNote ? { parentId: parentNote.title } : undefined,
      });
    }
    case "suggest_note_edit": {
      const note = await findOne("vault_page", params.note, "note");
      const title = text(params, "title");
      const body = typeof params.body === "string" ? params.body : undefined;
      if (title === undefined && body === undefined) throw new Error("Suggest a new title or body.");
      return leaveDraft(session, params, {
        kind: "edit_vault_note", tool: name, resourceId: idOf(note), resourceType: "vault_page", project: note.project,
        summary: `Edit note: ${note.title}`, payload: { ...(title ? { title } : {}), ...(body !== undefined ? { body } : {}) },
        expectedRevision: field(note, "updated-at"),
      });
    }
    case "suggest_note_append": {
      const note = await findOne("vault_page", params.note, "note");
      const addition = text(params, "addition", true) as string;
      return leaveDraft(session, params, {
        kind: "append_vault_note", tool: name, resourceId: idOf(note), resourceType: "vault_page", project: note.project,
        summary: `Add to note: ${note.title}`, payload: { addition }, expectedRevision: field(note, "updated-at"),
      });
    }
    case "suggest_log_entry": {
      const body = text(params, "body", true) as string;
      const entryDate = text(params, "entryDate");
      if (entryDate && !/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) throw new Error("entryDate must be YYYY-MM-DD.");
      const kind = oneOf(params, "kind", LOG_KINDS);
      return leaveDraft(session, params, {
        kind: "create_log_entry", tool: name, resourceId: randomUUID(), resourceType: "log_entry", project: await home(),
        summary: `New log entry${entryDate ? ` for ${entryDate}` : ""}`,
        payload: { body, ...(entryDate ? { entryDate } : {}), ...(kind ? { kind } : {}) },
      });
    }
    case "suggest_milestone": {
      const title = text(params, "title", true) as string;
      const status = oneOf(params, "status", MILESTONE_STATUSES);
      const description = text(params, "description");
      const targetDate = text(params, "targetDate");
      return leaveDraft(session, params, {
        kind: "milestone_follow_up", tool: name, resourceId: randomUUID(), resourceType: "milestone", project: await home(),
        summary: `New milestone: ${title}`,
        payload: { title, ...(description ? { description } : {}), ...(status ? { status } : {}), ...(targetDate ? { targetDate } : {}) },
      });
    }
    case "suggest_milestone_status": {
      const milestone = await findOne("milestone", params.milestone, "milestone");
      const status = oneOf(params, "status", MILESTONE_STATUSES, true);
      return leaveDraft(session, params, {
        kind: "milestone_status", tool: name, resourceId: idOf(milestone), resourceType: "milestone", project: milestone.project,
        summary: `Mark '${milestone.title}' ${status}`, payload: { status },
      });
    }
    case "suggest_experiment": {
      const experiment = text(params, "name", true) as string;
      const hypothesis = text(params, "hypothesis");
      const status = oneOf(params, "status", EXPERIMENT_STATUSES);
      return leaveDraft(session, params, {
        kind: "experiment_follow_up", tool: name, resourceId: randomUUID(), resourceType: "experiment", project: await home(),
        summary: `New experiment: ${experiment}`,
        payload: { name: experiment, ...(hypothesis ? { hypothesis } : {}), ...(status ? { status } : {}) },
      });
    }
    case "suggest_experiment_update": {
      const experiment = await findOne("experiment", params.experiment, "experiment");
      const status = oneOf(params, "status", EXPERIMENT_STATUSES);
      const metrics = params.metrics;
      if (metrics !== undefined && (typeof metrics !== "object" || metrics === null || Array.isArray(metrics)
        || Object.values(metrics).some((v) => typeof v !== "number"))) throw new Error("metrics must map names to numbers.");
      const artifacts = params.artifacts;
      if (artifacts !== undefined && !(Array.isArray(artifacts) && artifacts.every((a) => typeof a === "string"))) {
        throw new Error("artifacts must be a list of strings.");
      }
      if (!status && metrics === undefined && artifacts === undefined) throw new Error("Suggest a status, metrics or artifacts.");
      return leaveDraft(session, params, {
        kind: "experiment_update", tool: name, resourceId: idOf(experiment), resourceType: "experiment", project: experiment.project,
        summary: `Update experiment: ${experiment.title}`,
        payload: { ...(status ? { status } : {}), ...(metrics ? { metrics } : {}), ...(artifacts ? { artifacts } : {}) },
      });
    }
    case "suggest_paper_update": {
      const paper = pick(await papers(), params.paper, "paper");
      const status = oneOf(params, "status", PAPER_STATUSES);
      const rating = params.rating;
      if (rating !== undefined && !(Number.isInteger(rating) && (rating as number) >= 0 && (rating as number) <= 5)) {
        throw new Error("rating must be a whole number from 0 to 5.");
      }
      const tags = params.tags;
      if (tags !== undefined && !(Array.isArray(tags) && tags.every((t) => typeof t === "string"))) throw new Error("tags must be a list of strings.");
      if (!status && rating === undefined && tags === undefined) throw new Error("Suggest a status, rating or tags.");
      return leaveDraft(session, params, {
        kind: "paper_update", tool: name, resourceId: idOf(paper), resourceType: "paper", project: paper.project,
        summary: `Update paper: ${paper.title}`,
        payload: { ...(status ? { status } : {}), ...(rating !== undefined ? { rating } : {}), ...(tags ? { tags } : {}) },
        expectedRevision: field(paper, "updated-at"),
      });
    }
    case "suggest_paper_note": {
      const paper = pick(await papers(), params.paper, "paper");
      const addition = text(params, "addition", true) as string;
      return leaveDraft(session, params, {
        kind: "append_paper_note", tool: name, resourceId: idOf(paper), resourceType: "paper", project: paper.project,
        summary: `Add to notes on: ${paper.title}`, payload: { addition }, expectedRevision: field(paper, "updated-at"),
      });
    }
    case "suggest_annotation": {
      const paper = pick(await papers(), params.paper, "paper");
      const quote = text(params, "quote", true) as string;
      const comment = text(params, "comment");
      const page = params.page;
      if (page !== undefined && !(Number.isInteger(page) && (page as number) >= 1)) throw new Error("page must be 1 or more.");
      return leaveDraft(session, params, {
        kind: "paper_annotation", tool: name, resourceId: idOf(paper), resourceType: "paper", project: paper.project,
        summary: `Highlight in: ${paper.title}`,
        payload: { quote, ...(comment ? { comment } : {}), ...(page !== undefined ? { pageIndex: (page as number) - 1 } : {}) },
      });
    }
    case "suggest_relation": {
      const fromPaper = pick(await papers(), params.from, "paper");
      const from = idOf(fromPaper);
      const toPaper = pick(await papers(fromPaper.project), params.to, "paper");
      const to = idOf(toPaper);
      if (from === to) throw new Error("A paper cannot be linked to itself.");
      const relation = oneOf(params, "relation", RELATION_TYPES, true);
      return leaveDraft(session, params, {
        kind: "relation", tool: name, resourceId: from, resourceType: "paper_relation", project: fromPaper.project,
        summary: `Link: ${fromPaper.title} ${String(relation).replace(/_/g, " ")} ${toPaper.title}`, payload: { fromPaper: from, toPaper: to, relation },
        shown: { fromPaper: "", toPaper: "", relation: "" },
      });
    }
    case "suggest_reading_list_change": {
      const list = await findOne("reading_list", params.list, "reading list");
      const paperEntry = text(params, "paper") ? pick(await papers(list.project), params.paper, "paper") : undefined;
      const noteEntry = text(params, "note") ? await findOne("vault_page", params.note, "note", list.project) : undefined;
      const paper = paperEntry ? idOf(paperEntry) : undefined;
      const note = noteEntry ? idOf(noteEntry) : undefined;
      if (!paper === !note) throw new Error("Name exactly one paper or one note.");
      const comment = text(params, "comment");
      return leaveDraft(session, params, {
        kind: "reading_list_change", tool: name, resourceId: idOf(list), resourceType: "reading_list_item", project: list.project,
        summary: `Add to reading list: ${list.title}`,
        payload: { listId: idOf(list), ...(paper ? { paperId: paper } : { vaultPageId: note }), ...(comment ? { note: comment } : {}) },
        shown: { listId: "", paperId: paperEntry?.title ?? "", vaultPageId: noteEntry?.title ?? "" },
      });
    }
    case "suggest_report_edit": {
      const section = await findOne("report_section", params.section, "report section");
      // propose_report_edit called the text `proposal`.
      const notes = text(params, "notes") ?? text(params, "proposal");
      if (!notes) throw new Error("notes is required.");
      // Report files carry no updated-at, so there is no revision to check against.
      return leaveDraft(session, params, {
        kind: "report_edit", tool: name, resourceId: idOf(section), resourceType: "report_section", project: section.project,
        summary: `New notes for: ${section.title}`, payload: { notes },
      });
    }
    default:
      throw new Error(`No tool named ${rawName}.`);
  }
}

/** What tools/list answers for a token that may suggest; the bridge caches it for when the app is closed. */
export function listedTools(withTracking: boolean): readonly unknown[] {
  return withTracking ? [...TOOLS, TRACKING_TOOL] : TOOLS;
}

/** Answer one JSON-RPC request; a notification (no id) gets null and nothing is sent. */
export async function routeMcpRequest(
  session: VaultSession,
  request: JsonRpcRequest,
  rank?: SemanticRanker,
  canSuggest = true,
  tracking?: TrackingSetup,
  projects?: ProjectSource,
): Promise<JsonRpcResponse | null> {
  const id = request.id ?? null;
  const params = request.params ?? {};

  switch (request.method) {
    case "initialize":
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "weaveforge-workspace", version: "1" },
      });
    case "notifications/initialized":
      return null;
    case "ping":
      return ok(id, {});
    case "tools/list": {
      const tools = canSuggest ? TOOLS : TOOLS.filter((t) => !t.name.startsWith("suggest_"));
      return ok(id, { tools: tracking ? [...tools, TRACKING_TOOL] : tools });
    }
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const args = (params.arguments as Record<string, unknown> | undefined) ?? {};
      if (!canSuggest && canonicalAiToolName(name).startsWith("suggest_"))
        return ok(id, {
          isError: true,
          content: [{ type: "text", text: "This token may read only; it cannot leave drafts." }],
        });
      if (name === TRACKING_TOOL.name) {
        if (!tracking)
          return ok(id, {
            isError: true,
            content: [{ type: "text", text: "This token cannot log experiments. Press Connect in WeaveForge again." }],
          });
        return ok(id, { content: [{ type: "text", text: await trackingSetup(tracking) }] });
      }
      try {
        return ok(id, await callTool(session, name, args, rank, projects));
      } catch (error) {
        // A tool error, not a protocol one: the call was well-formed and the answer is "no".
        return ok(id, {
          isError: true,
          content: [{ type: "text", text: error instanceof Error ? error.message : "That did not work." }],
        });
      }
    }
    default:
      return id === null ? null : err(id, -32601, `No method named ${request.method ?? ""}.`);
  }
}
