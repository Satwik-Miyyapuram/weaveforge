import type {
  WorkshopProject,
  WorkshopProjectsResult,
} from "@/features/overleaf/infrastructure/workshop-session-client";
import { readyCore } from "@/lib/rust-core";
import type { LinkedReport } from "../ui/linked-overleaf-api";

// --- edited-label ---
/**
 * "edited 3h ago" for a section's meta line: minutes, hours and days for the
 * last week, then the date. Returns null without a timestamp, so sections read
 * before the column existed simply show nothing.
 */
export function editedLabel(updatedAt: string | undefined, now: Date = new Date()): string | null {
  if (!updatedAt) return null;
  const then = new Date(updatedAt);
  const seconds = (now.getTime() - then.getTime()) / 1000;
  if (Number.isNaN(seconds)) return null;
  const relative = readyCore().editedRelativeLabel(seconds);
  if (relative != null) return relative;
  // The date form depends on the reader's locale, so it stays in JS.
  return `edited ${then.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

// --- overleaf-project-list ---
/** One Overleaf project in the tab's list: from the signed-in account, linked to this project, or both. */
export interface OverleafProjectRow {
  /** The Overleaf project id. */
  id: string;
  name: string;
  /** The signed-in account can open it (live editing and the PDF need this). */
  inAccount: boolean;
  /** Its link to this WeaveForge project (git token), if any. */
  report: LinkedReport | null;
}

/** Account projects and linked reports as one list, matched on the Overleaf id; linked first, then by name. */
export function mergeOverleafProjects(account: readonly WorkshopProject[] | null, linked: readonly LinkedReport[]): OverleafProjectRow[] {
  const rows: OverleafProjectRow[] = readyCore()
    .mergeOverleafProjects(account ?? [], linked)
    .map((m) => ({ id: m.id, name: m.name, inAccount: m.inAccount, report: m.linkedIndex === null ? null : (linked[m.linkedIndex] ?? null) }));
  return rows.sort(
    (a, b) => Number(!!b.report) - Number(!!a.report) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/** Rows whose name or linked title contains the query. */
export function filterOverleafProjects(rows: readonly OverleafProjectRow[], query: string): OverleafProjectRow[] {
  return rows.filter((r) => readyCore().overleafProjectMatches(r.name, r.report?.title ?? null, query));
}

/** The rows the list shows: linked ones always, account ones only if picked. Null `picked` (nothing chosen yet) shows all. */
export function pickedOverleafProjects(rows: readonly OverleafProjectRow[], picked: ReadonlySet<string> | null): OverleafProjectRow[] {
  if (!picked) return [...rows];
  const ids = [...picked];
  return rows.filter((r) => readyCore().overleafProjectShown(!!r.report, r.id, ids));
}

// --- overleaf-thumbs ---
/**
 * The first page of an Overleaf project's PDF, as a small picture for its card.
 *
 * Getting the PDF means asking Overleaf to compile, so a picture is made once
 * per project and kept on this device. Opening the project's PDF refreshes it
 * (see `WorkshopPdfViewer`). Signed out, a kept picture still shows.
 */
export interface ThumbStore {
  get: (key: string) => string | null;
  set: (key: string, value: string) => void;
}

export interface OverleafThumbDeps {
  store: ThumbStore;
  /** The compiled PDF, or null when Overleaf could not give one. */
  fetchPdf: (sessionId: string, projectId: string) => Promise<Blob | null>;
  /** Page 1 of the PDF as a data URL. */
  render: (pdf: Blob) => Promise<string>;
}

const keyOf = (projectId: string) => readyCore().thumbKey(projectId);

export function readOverleafThumb(store: ThumbStore, projectId: string): string | null {
  try {
    return store.get(keyOf(projectId));
  } catch {
    return null;
  }
}

export function saveOverleafThumb(store: ThumbStore, projectId: string, dataUrl: string): void {
  if (!readyCore().thumbFits(dataUrl.length)) return;
  try {
    store.set(keyOf(projectId), dataUrl);
  } catch {
    // Storage full or denied: the picture lasts until the card unmounts.
  }
}

/** The kept picture, else one made now when signed in. Null on any failure. */
export async function loadOverleafThumb(
  deps: OverleafThumbDeps,
  sessionId: string | null,
  projectId: string,
): Promise<string | null> {
  const kept = readOverleafThumb(deps.store, projectId);
  if (kept) return kept;
  if (!sessionId) return null;
  try {
    const pdf = await deps.fetchPdf(sessionId, projectId);
    if (!pdf) return null;
    const dataUrl = await deps.render(pdf);
    saveOverleafThumb(deps.store, projectId, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}

/** Runs tasks one after another, so a long list does not start every compile at once. */
export function serialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return (task) => {
    const next = tail.then(task, task);
    tail = next.catch(() => undefined);
    return next;
  };
}

// --- overleaf-tree-rows ---
/** One row under the editor's Overleaf folder. */
export interface OverleafTreeRow {
  id: string;
  name: string;
}

/** The row shown when there is nothing to open yet: it opens the Overleaf screen to sign in. */
export const SIGN_IN_ROW: OverleafTreeRow = { id: "projects", name: "Sign in to Overleaf" };

export interface OverleafTreeDeps {
  /** Sign-in routes exist (see `canShowWorkshop`). */
  workshop: boolean;
  /** The open WeaveForge project, whose linked reports also show. */
  projectId: string | null;
  sessionId: () => string | null;
  listAccount: (sessionId: string) => Promise<WorkshopProjectsResult>;
  listLinked: (projectId: string) => Promise<LinkedReport[]>;
  /** The account projects chosen to show; null shows all. */
  picked: () => string[] | null;
}

/**
 * The same projects the Overleaf screen lists (linked first, then the picked
 * account projects), as rows for the editor's sidebar. Never throws: a list
 * that fails is left out. Signed out with nothing linked, one row to sign in.
 */
export async function loadOverleafTreeRows(deps: OverleafTreeDeps): Promise<OverleafTreeRow[]> {
  const sessionId = deps.workshop ? deps.sessionId() : null;
  const [account, linked] = await Promise.all([
    sessionId
      ? deps.listAccount(sessionId).then((result) => (result.ok ? result.projects : null), () => null)
      : Promise.resolve(null),
    deps.projectId ? deps.listLinked(deps.projectId).catch(() => []) : Promise.resolve([]),
  ]);
  const ids = deps.picked();
  const rows = pickedOverleafProjects(mergeOverleafProjects(account, linked), ids ? new Set(ids) : null);
  if (account === null && rows.length === 0) return [SIGN_IN_ROW];
  return rows.map((row) => ({ id: row.id, name: row.name }));
}
