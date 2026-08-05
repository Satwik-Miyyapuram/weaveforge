/**
 * Workspace snapshot → indexable documents.
 *
 * Pure, so ranking behaviour can be tested without a search library or a
 * browser. This is the one place that decides what "content" means for each
 * entity; the AI retriever's `sourceText` makes the same decision for its own
 * purposes and the two should be kept in step.
 */

import type { WorkspaceSnapshot } from "../workspace/workspace-snapshot.js";
import { extractHashtags } from "../features/papers/domain/paper.js";
import { MAX_INDEXED_BODY_CHARS } from "./search-tuning.js";
import type { SearchDoc, SearchKind } from "./search-port.js";

/** ATX headings h1–h3. Setext headings are rare in app-authored markdown. */
const HEADING_RE = /^ {0,3}(#{1,3})\s+(.+?)\s*#*\s*$/gm;

/** Fenced and inline code, so `# not a heading` inside a snippet is ignored. */
function maskCode(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, (m) => " ".repeat(m.length))
    .replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length));
}

export function extractHeadings(body?: string): string[] {
  if (!body) return [];
  const masked = maskCode(body);
  const out: string[] = [];
  HEADING_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HEADING_RE.exec(masked)) !== null) {
    const text = match[2]?.trim();
    if (text) out.push(text);
  }
  return out;
}

/** Long bodies are truncated, never dropped: the title still has to be findable. */
function boundedBody(body: string | undefined): string {
  if (!body) return "";
  return body.length > MAX_INDEXED_BODY_CHARS ? body.slice(0, MAX_INDEXED_BODY_CHARS) : body;
}

interface TreeNode {
  id: string;
  title: string;
  parentId?: string;
}

/**
 * Ancestor-title breadcrumb, e.g. "Method/Baselines". Cycles are broken by a
 * visited set — a corrupted parent chain must not hang the indexer.
 */
function breadcrumbs(nodes: readonly TreeNode[]): Map<string, string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, string>();
  for (const node of nodes) {
    const parts: string[] = [];
    const seen = new Set<string>([node.id]);
    let current = node.parentId ? byId.get(node.parentId) : undefined;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      parts.unshift(current.title);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    out.set(node.id, parts.join("/"));
  }
  return out;
}

function doc(partial: Omit<SearchDoc, "id" | "degree"> & { degree?: number }): SearchDoc {
  return {
    ...partial,
    id: `${partial.kind}:${partial.entityId}`,
    body: boundedBody(partial.body),
    degree: partial.degree ?? 0,
  };
}

function href(kind: SearchKind, id: string): string {
  const routes: Record<SearchKind, string> = {
    paper: `/papers?paper=${encodeURIComponent(id)}`,
    note: `/notes?page=${encodeURIComponent(id)}`,
    section: `/report?section=${encodeURIComponent(id)}`,
    experiment: `/experiments?experiment=${encodeURIComponent(id)}`,
    milestone: `/plan?milestone=${encodeURIComponent(id)}`,
    list: `/lists`,
    log: `/log`,
    // PDF page documents build their own href (they need the page number);
    // this entry exists only so the map stays exhaustive over SearchKind.
    pdf: `/reader?paper=${encodeURIComponent(id)}`,
  };
  return routes[kind];
}

/**
 * Project a snapshot into search documents.
 *
 * `degrees` carries wiki-graph link counts when available; entities absent from
 * it rank on content alone.
 */
export function toSearchDocs(
  snapshot: WorkspaceSnapshot,
  degrees: ReadonlyMap<string, number> = new Map(),
): SearchDoc[] {
  const docs: SearchDoc[] = [];
  const degreeOf = (id: string) => degrees.get(id) ?? 0;

  const notePaths = breadcrumbs(snapshot.vaultPages);
  for (const page of snapshot.vaultPages) {
    docs.push(
      doc({
        kind: "note",
        entityId: page.id,
        title: page.title,
        aliases: [],
        headings: extractHeadings(page.body),
        // Notes carry their tags as #hashtags in the body — the body is the
        // source of truth for tags everywhere else in the app.
        tags: extractHashtags(page.body),
        path: notePaths.get(page.id) ?? "",
        body: page.body,
        updatedAt: page.updatedAt || page.createdAt,
        href: href("note", page.id),
        degree: degreeOf(`note:${page.id}`),
      }),
    );
  }

  for (const paper of snapshot.papers) {
    docs.push(
      doc({
        kind: "paper",
        entityId: paper.id,
        title: paper.title,
        // Authors and venue behave like aliases: people search papers by who
        // wrote them at least as often as by title.
        aliases: [...paper.authors, paper.venue, paper.doi, paper.arxivId].filter(
          (v): v is string => Boolean(v),
        ),
        headings: extractHeadings(paper.summary),
        tags: [...paper.tags, ...extractHashtags(paper.summary)],
        path: paper.year ? String(paper.year) : "",
        body: [paper.abstract, paper.summary].filter(Boolean).join("\n\n"),
        updatedAt: paper.updatedAt || paper.createdAt,
        href: href("paper", paper.id),
        degree: degreeOf(`paper:${paper.id}`),
      }),
    );
  }

  const listPaths = breadcrumbs(
    snapshot.readingLists.map((l) => ({ id: l.id, title: l.name, parentId: l.parentId })),
  );
  for (const list of snapshot.readingLists) {
    docs.push(
      doc({
        kind: "list",
        entityId: list.id,
        title: list.name,
        aliases: [],
        headings: [],
        tags: [],
        path: listPaths.get(list.id) ?? "",
        body: list.description ?? "",
        updatedAt: list.createdAt,
        href: href("list", list.id),
        degree: degreeOf(`list:${list.id}`),
      }),
    );
  }

  const sectionPaths = breadcrumbs(snapshot.reportSections);
  for (const section of snapshot.reportSections) {
    docs.push(
      doc({
        kind: "section",
        entityId: section.id,
        title: section.title,
        // "3.2" is how people refer to a section out loud, so it is searchable.
        aliases: section.sectionNo ? [section.sectionNo] : [],
        headings: extractHeadings(section.notes),
        tags: extractHashtags(section.notes),
        path: sectionPaths.get(section.id) ?? "",
        body: section.notes ?? "",
        updatedAt: section.createdAt,
        href: href("section", section.id),
        degree: degreeOf(`section:${section.id}`),
      }),
    );
  }

  for (const experiment of snapshot.experiments) {
    docs.push(
      doc({
        kind: "experiment",
        entityId: experiment.id,
        title: experiment.name,
        aliases: [experiment.branch, experiment.commitSha].filter((v): v is string => Boolean(v)),
        headings: [],
        tags: [],
        path: experiment.status,
        body: [experiment.hypothesis, experiment.resultNote, experiment.runCommand]
          .filter(Boolean)
          .join("\n\n"),
        updatedAt: experiment.finishedAt || experiment.startedAt || experiment.createdAt,
        href: href("experiment", experiment.id),
        degree: degreeOf(`experiment:${experiment.id}`),
      }),
    );
  }

  for (const milestone of snapshot.milestones) {
    docs.push(
      doc({
        kind: "milestone",
        entityId: milestone.id,
        title: milestone.title,
        aliases: milestone.targetDate ? [milestone.targetDate] : [],
        headings: [],
        tags: [],
        path: milestone.status,
        body: milestone.description ?? "",
        updatedAt: milestone.createdAt,
        href: href("milestone", milestone.id),
        degree: degreeOf(`milestone:${milestone.id}`),
      }),
    );
  }

  for (const entry of snapshot.logEntries) {
    docs.push(
      doc({
        kind: "log",
        entityId: entry.id,
        // Log entries have no title; the date is what people scan for.
        title: entry.entryDate,
        aliases: [entry.kind],
        headings: extractHeadings(entry.body),
        tags: extractHashtags(entry.body),
        path: entry.entryDate.slice(0, 7),
        body: entry.body,
        updatedAt: entry.createdAt,
        href: href("log", entry.id),
        degree: degreeOf(`log:${entry.id}`),
      }),
    );
  }

  return docs;
}

/**
 * Fingerprint of the indexed corpus. A persisted index whose revision differs
 * from a freshly computed one is stale and must be rebuilt — this is what stops
 * a cached index from silently serving deleted or pre-edit documents.
 */
export function searchRevision(docs: readonly SearchDoc[]): string {
  let latest = "";
  for (const d of docs) if (d.updatedAt > latest) latest = d.updatedAt;
  return `${docs.length}:${latest}`;
}
