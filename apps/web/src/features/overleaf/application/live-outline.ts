import { parseLatexSectionTree, type LatexSectionTreeResult } from "@weaveforge/core";
import { closeLiveProject, loadLiveDoc, openLiveProject } from "../infrastructure/workshop-live-client";
import type { WorkshopClientDeps } from "../infrastructure/workshop-session-client";

/** A project's sources and section tree, read through a sign-in session. */
export interface LiveOutline {
  files: { path: string; content: string }[];
  entryFile: string;
  sectionTree: LatexSectionTreeResult;
}

export type LiveOutlineResult = { ok: true; content: LiveOutline } | { ok: false; expired: boolean; message: string };

/**
 * Reads every doc of the project once over the live connection and builds the
 * section tree from the project's main document. Read only; the connection is
 * closed again before returning.
 */
export async function loadLiveOutline(deps: WorkshopClientDeps, sessionId: string, projectId: string): Promise<LiveOutlineResult> {
  const opened = await openLiveProject(deps, sessionId, projectId);
  if (!opened.ok) return opened;
  try {
    const loaded = await Promise.all(opened.docs.map(async (doc) => ({ doc, res: await loadLiveDoc(deps, opened.liveId, doc.id) })));
    const files: LiveOutline["files"] = [];
    for (const { doc, res } of loaded) {
      if (!res.ok) return { ok: false, expired: false, message: res.message };
      files.push({ path: doc.path, content: res.text });
    }
    const entryFile = opened.docs.find((d) => d.id === opened.rootDocId)?.path ?? "main.tex";
    return { ok: true, content: { files, entryFile, sectionTree: parseLatexSectionTree(files, entryFile) } };
  } finally {
    await closeLiveProject(deps, opened.liveId);
  }
}
