/**
 * Workspace snapshot → a folder of markdown.
 *
 * Produces a plain path→content map rather than writing anything, so the same
 * output can go to a ZIP, to OPFS, or to a test double. Pure and deterministic:
 * re-serializing an unchanged workspace yields byte-identical files, which is
 * what keeps git diffs meaningful.
 */

import type { WorkspaceSnapshot } from "./workspace-snapshot.js";
import { workspaceSnapshotCounts } from "./workspace-snapshot.js";
import { writeFrontmatter } from "./frontmatter.js";
import { toRelativeBlobLinks } from "./blob-links.js";
import {
  ENTITY_DIRS,
  WORKSPACE_META_DIR,
  flatPath,
  logPath,
  treePaths,
  type WorkspaceEntityType,
} from "./folder-layout.js";

/** Format version of the folder layout, stamped into the manifest. */
export const WORKSPACE_SCHEMA_VERSION = 1;

export interface SerializedWorkspace {
  /** Markdown and JSON, keyed by folder-relative path. */
  files: Record<string, string>;
  /**
   * Blobs the folder references, as storage paths to fetch. The caller resolves
   * them — this module never does I/O.
   */
  assets: { storagePath: string; folderPath: string }[];
}

function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function markdown(
  path: string,
  id: string,
  type: WorkspaceEntityType,
  fields: Record<string, string | number | boolean | string[] | undefined>,
  body: string,
  assets: SerializedWorkspace["assets"],
): string {
  const rewritten = toRelativeBlobLinks(body ?? "", path);
  for (const asset of rewritten.assets) {
    assets.push({ storagePath: asset.storagePath, folderPath: asset.folderPath });
  }
  return writeFrontmatter(
    { "weaveforge-id": id, "weaveforge-type": type, ...fields },
    rewritten.body,
  );
}

export function serializeWorkspace(snapshot: WorkspaceSnapshot): SerializedWorkspace {
  const files: Record<string, string> = {};
  const assets: SerializedWorkspace["assets"] = [];

  // --- notes, reading lists, report sections: nested by parentId ------------
  const notePaths = treePaths(snapshot.vaultPages, ENTITY_DIRS.vault_page);
  for (const page of snapshot.vaultPages) {
    const path = notePaths.get(page.id)!;
    files[path] = markdown(
      path,
      page.id,
      "vault_page",
      { title: page.title, "updated-at": page.updatedAt, "created-at": page.createdAt },
      page.body,
      assets,
    );
  }

  const listPaths = treePaths(
    snapshot.readingLists.map((l) => ({ id: l.id, title: l.name, parentId: l.parentId })),
    ENTITY_DIRS.reading_list,
  );
  for (const list of snapshot.readingLists) {
    const path = listPaths.get(list.id)!;
    files[path] = markdown(
      path,
      list.id,
      "reading_list",
      { title: list.name, color: list.color, "created-at": list.createdAt },
      list.description ?? "",
      assets,
    );
  }

  const sectionPaths = treePaths(snapshot.reportSections, ENTITY_DIRS.report_section);
  for (const section of snapshot.reportSections) {
    const path = sectionPaths.get(section.id)!;
    files[path] = markdown(
      path,
      section.id,
      "report_section",
      {
        title: section.title,
        "section-no": section.sectionNo,
        status: section.status,
        "target-words": section.targetWords,
        deadline: section.deadline,
        "created-at": section.createdAt,
      },
      section.notes ?? "",
      assets,
    );
  }

  // --- flat entities --------------------------------------------------------
  for (const paper of snapshot.papers) {
    const path = flatPath("paper", paper.id, paper.title);
    files[path] = markdown(
      path,
      paper.id,
      "paper",
      {
        title: paper.title,
        authors: paper.authors,
        year: paper.year,
        venue: paper.venue,
        doi: paper.doi,
        "arxiv-id": paper.arxivId,
        url: paper.url,
        status: paper.status,
        rating: paper.rating,
        tags: paper.tags,
        "updated-at": paper.updatedAt,
      },
      // Abstract then notes: the file reads as the paper, with your notes under it.
      [paper.abstract ? `## Abstract\n\n${paper.abstract}` : "", paper.summary ?? ""]
        .filter(Boolean)
        .join("\n\n"),
      assets,
    );
  }

  for (const experiment of snapshot.experiments) {
    const path = flatPath("experiment", experiment.id, experiment.name);
    files[path] = markdown(
      path,
      experiment.id,
      "experiment",
      {
        title: experiment.name,
        status: experiment.status,
        "repo-url": experiment.repoUrl,
        "commit-sha": experiment.commitSha,
        branch: experiment.branch,
        "created-at": experiment.createdAt,
      },
      [
        experiment.hypothesis ? `## Hypothesis\n\n${experiment.hypothesis}` : "",
        experiment.resultNote ? `## Result\n\n${experiment.resultNote}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      assets,
    );
  }

  for (const milestone of snapshot.milestones) {
    const path = flatPath("milestone", milestone.id, milestone.title);
    files[path] = markdown(
      path,
      milestone.id,
      "milestone",
      {
        title: milestone.title,
        status: milestone.status,
        "target-date": milestone.targetDate,
        "created-at": milestone.createdAt,
      },
      milestone.description ?? "",
      assets,
    );
  }

  for (const entry of snapshot.logEntries) {
    const path = logPath(entry.id, entry.entryDate);
    files[path] = markdown(
      path,
      entry.id,
      "log_entry",
      { "entry-date": entry.entryDate, kind: entry.kind, "created-at": entry.createdAt },
      entry.body,
      assets,
    );
  }

  // --- data with no natural prose form -------------------------------------
  files[`${WORKSPACE_META_DIR}/relations.json`] = stableJson(snapshot.relations);
  files[`${WORKSPACE_META_DIR}/tags.json`] = stableJson(snapshot.tags);
  files[`${WORKSPACE_META_DIR}/reading-list-items.json`] = stableJson(snapshot.readingListItems);

  files[`${WORKSPACE_META_DIR}/manifest.json`] = stableJson({
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    generatedAt: snapshot.collectedAt,
    app: "WeaveForge",
    counts: workspaceSnapshotCounts(snapshot),
  });

  files["README.md"] = [
    "# WeaveForge workspace",
    "",
    `Exported ${snapshot.collectedAt}.`,
    "",
    "Every file carries a `weaveforge-id` in its frontmatter. That id is what",
    "identifies the entity — renaming or moving a file is safe, and the id is",
    "how a re-import matches it back up. A file without one is treated as new.",
    "",
    "Folders mirror the app: notes/, papers/, report/, experiments/, plan/,",
    "logbook/, reading-lists/. A note with children becomes a folder holding a",
    "same-named file for its own text.",
    "",
    "`.weaveforge/` holds data with no natural prose form (relations, tags) and",
    "a rebuildable manifest.",
    "",
  ].join("\n");

  // Deduplicate: one asset referenced from several bodies is fetched once.
  const seen = new Set<string>();
  const uniqueAssets = assets.filter((asset) => {
    if (seen.has(asset.folderPath)) return false;
    seen.add(asset.folderPath);
    return true;
  });

  return { files, assets: uniqueAssets };
}
