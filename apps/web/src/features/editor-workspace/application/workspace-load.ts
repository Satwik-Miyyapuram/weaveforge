/**
 * The workspace's documents, in one load: every note, paper and report
 * section as a `Document`, the `@`/`[[` completion rows, the explorer tree,
 * and the reading lists as a view over the same rows.
 *
 * Out of the screen because it is the one part of it that is not wiring: a
 * reload is a pure function of the container's screen data and the bodies
 * already hydrated, and the screen only has to put the result into state.
 */

import { isInkNoteBody, normalizeTitleKey } from "@weaveforge/core";

import { getContainer } from "@/bootstrap";
import { paperCiteLabel, type CiteCompletion } from "@/lib/hooks/use-cite-links";
import { isHydratedPage, noteBodyText } from "@/lib/page-text";
import { memberRank } from "../ui/kind";
import {
  buildListsTree,
  buildWorkspaceTree,
  listMembership,
  type ListItemEntry,
  type WorkspaceTreeNode,
} from "./workspace-tree";

/**
 * A note is one kind whatever its body holds: a note with ink in its header
 * (§4.1) opens in Ink mode rather than being a second kind with a second
 * suffix. `ink_page` stays in the kind table for tabs saved before this.
 */
export const noteKind = (_body: string): "vault_page" => "vault_page";

/** Whether a note's body says it is written in ink, so its tab opens in Ink mode. */
export const noteOpensInInk = (body: string): boolean => isInkNoteBody(body);
export interface Document {
  kind: string;
  id: string;
  title: string;
  body: string;
  /**
   * Whether `body` is the whole document. A note arrives from `vault.flat` as
   * a summary whose `bodyPreview` is the first 320 characters — enough to index
   * and to label, not enough to edit: an ink note's figure lines and page
   * breaks sit past that cut, and a save from a preview would write the
   * truncation over the note. A tab hydrates its document before mounting an
   * editor on it.
   */
  hydrated: boolean;
  /** Where the document sits, for the breadcrumbs. */
  path: string;
  /** A note's folder; the tree nests notes by parent. */
  parentId?: string;
  /** A paper's keyword tags, for `#tag` completion. Notes carry theirs inline. */
  tags?: readonly string[];
}

/** What a reload puts into the screen's state. */
export interface WorkspaceData {
  documents: Document[];
  completions: CiteCompletion[];
  tree: WorkspaceTreeNode[];
  listsTree: WorkspaceTreeNode[];
  membership: ReadonlyMap<string, string[]>;
}

/**
 * Load the workspace. `hydrated` is the full note bodies fetched so far, by
 * id: a reload rebuilds the set from summaries, and a note already hydrated
 * keeps its full body as long as the summary still describes it.
 */
export async function loadWorkspace(hydrated: ReadonlyMap<string, string>): Promise<WorkspaceData> {
  const container = getContainer();
  const [vault, papers, report, lists] = await Promise.all([
    container.vault.loadScreenData(),
    container.papers.loadScreenData().catch(() => null),
    container.report.loadScreenData().catch(() => null),
    container.readingLists.loadScreenData().catch(() => null),
  ]);

  const paperRows = papers?.papers ?? [];
  const sectionRows = report?.flat ?? [];
  const listRows = lists?.lists ?? [];
  // A reload rebuilds the set from summaries; a note already hydrated keeps
  // its full body as long as the summary still describes it — the preview
  // is the body's head, so a body that changed underneath shows as a
  // preview that no longer matches, and the tab hydrates again.
  const previous = hydrated;
  const loaded: Document[] = [
    ...vault.flat.map((page) => {
      // `vault.flat` holds summaries, which have no `body` — reading one off
      // them was always `undefined`, so every note in the workspace was
      // indexed with an empty body. `noteBodyText` prefers the full body when
      // the entry has been hydrated and falls back to the preview otherwise.
      const summary = noteBodyText(page);
      const kept = previous.get(page.id);
      const keep = kept !== undefined && !isHydratedPage(page) && kept.startsWith(summary);
      const body = keep ? kept : summary;
      const kind = noteKind(body);
      return {
        kind,
        id: page.id,
        title: page.title,
        body,
        hydrated: keep || isHydratedPage(page),
        path: `notes/${page.title || "Untitled"}.note.md`,
        parentId: page.parentId ?? undefined,
      };
    }),
    // Two documents per paper: its notes and its PDF. The PDF row has no body
    // of its own — the reader fetches the file by the paper's id.
    ...paperRows.flatMap((paper) => [
      {
        kind: "paper",
        id: paper.id,
        title: paper.title,
        body: paper.summary ?? "",
        hydrated: true,
        path: `papers/${paper.title || "Untitled"}.paper.md`,
        tags: paper.tags,
      },
      {
        kind: "paper_pdf",
        id: paper.id,
        title: paper.title,
        body: "",
        hydrated: true,
        path: `papers/${paper.title || "Untitled"}.pdf`,
        tags: paper.tags,
      },
    ]),
    ...sectionRows.map((section) => ({
      kind: "report_section",
      id: section.id,
      title: section.title,
      body: section.notes ?? "",
      hydrated: true,
      path: `report/${section.title || "Untitled"}.report.md`,
    })),
  ];

  // The `@` and `[[` rows, in the shape `/notes` builds them: a paper's row
  // carries its authors and year so a cite can be formatted, a note's and a
  // section's just their title. Duplicate titles collapse to one row.
  const seen = new Set<string>();
  const rows: CiteCompletion[] = [];
  for (const paper of paperRows) {
    const key = normalizeTitleKey(paper.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push(paperCiteLabel(paper));
  }
  const titled = [
    ...vault.flat.map((page) => ({ title: page.title, detail: "note" })),
    ...sectionRows.map((section) => ({ title: section.title, detail: "section" })),
  ];
  for (const row of titled) {
    const key = normalizeTitleKey(row.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push({ title: row.title, label: row.title, detail: row.detail });
  }
  const completions = rows;
  const tree = buildWorkspaceTree({
      notes: vault.flat.map((page) => ({
        id: page.id,
        title: page.title,
        parentId: page.parentId ?? undefined,
        kind: noteKind(noteBodyText(page)),
      })),
      papers: paperRows.map((paper) => ({
        id: paper.id,
        title: paper.title,
        hasNote: Boolean(paper.summary?.trim()),
      })),
      reportSections: sectionRows.map((section) => ({
        id: section.id,
        title: section.title,
        parentId: section.parentId ?? undefined,
      })),
  });

  // Reading lists, as a view over the same documents rather than a second
  // copy of them. The membership rows are the many-to-many join in core.
  let listsTree: WorkspaceTreeNode[] = [];
  let membership: ReadonlyMap<string, string[]> = new Map();
  if (lists) {
    const titles = new Map<string, string>();
    for (const doc of loaded) titles.set(`${doc.kind}:${doc.id}`, doc.title);
    const listTitles = new Map(listRows.map((list) => [`reading_list:${list.id}`, list.name]));
    const items: ListItemEntry[] = [];
    if (listRows.length > 0) {
      const rows = await container.readingLists
        .listItemsForLists(listRows.map((list) => list.id))
        .catch(() => []);
      for (const row of rows) {
        if (row.paperId) {
          items.push({
            listId: row.listId,
            kind: "paper",
            id: row.paperId,
            inheritedFromListId: row.inheritedFromListId,
            duplicateOfItemId: row.duplicateOfItemId,
          });
        } else if (row.vaultPageId) {
          items.push({
            listId: row.listId,
            kind: "vault_page",
            id: row.vaultPageId,
            inheritedFromListId: row.inheritedFromListId,
            duplicateOfItemId: row.duplicateOfItemId,
          });
        }
      }
    }
    listsTree = buildListsTree({
        lists: listRows.map((list) => ({
          id: list.id,
          title: list.name,
          parentId: list.parentId,
          description: list.description,
        })),
        items,
        titles,
        // Papers before notes, from `kind.ts`'s own ordering column, so the
        // rule is not a comparison against `"paper"` in two places.
      memberRank,
    });
    membership = listMembership(items, new Map([...titles, ...listTitles]));
  }

  return { documents: loaded, completions, tree, listsTree, membership };
}
