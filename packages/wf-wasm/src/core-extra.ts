/**
 * Wrappers for the last core helpers ported to Rust (experiments, reading
 * lists, vault pages, wiki lint, ink pages and paths, folder layout, page
 * titles), re-exported from index.ts. The wrappers draw ids, clocks and random
 * values on the JS side and turn Rust error strings into named errors.
 */
import {
  mergeGraphPersistedState as rawMergeGraphPersistedState,
  createVaultPageWith as rawCreateVaultPageWith,
  buildPageTree as rawBuildPageTree,
  parseKindSuffix as rawParseKindSuffix,
  flatPath as rawFlatPath,
  logPath as rawLogPath,
  paperPdfPath as rawPaperPdfPath,
  paperHtmlPath as rawPaperHtmlPath,
  createExperimentWith as rawCreateExperimentWith,
  memberRoleLabelOf as rawMemberRoleLabelOf,
  lintWiki as rawLintWiki,
  planFixOrder as rawPlanFixOrder,
  contextNonceFrom,
  createReadingListWith as rawCreateReadingListWith,
  verdictsFor as rawVerdictsFor,
  inkSidecarDir as rawInkSidecarDir,
  inkChunkPath as rawInkChunkPath,
  parseInkChunkPath as rawParseInkChunkPath,
  newInkChunkId as rawNewInkChunkId,
  inkEngineInfo as rawInkEngineInfo,
  inkLineStrokes as rawInkLineStrokes,
  extractPageTitle as rawExtractPageTitle,
  inkEnumValue as rawInkEnumValue,
  makeInkStroke as rawMakeInkStroke,
  blankInkPage as rawBlankInkPage,
} from "../pkg/wf_wasm.js";

export {
  canonicalAiToolName,
  clampInkPageSize,
  contextNonceFrom,
  inkAttachmentIndex,
  inkEnumIndex,
  inkPageBackground,
  inkPageOverBudget,
  joinInkTextLayer,
  memberRoleLabelOf,
  resolveInkPageOrder,
  withInkPageBackground,
} from "../pkg/wf_wasm.js";

export {
  assetPath,
  decodeHtmlEntities,
  inkEngineRank,
  inkPageMarker,
  isInkEngineId,
  isInkNoteFrontmatter,
  isInkNoteId,
  pageTitleScanChars,
  writeInkNoteMeta,
} from "../pkg/wf_wasm.js";

/** A Rust error string as an `Error` named `name`; anything else unchanged. */
function asError(thrown: unknown, name: string): unknown {
  // Rust rejects with a string or with an unnamed `Error` (serde_wasm_bindgen).
  if (thrown instanceof Error && thrown.name === "Error") {
    thrown.name = name;
    return thrown;
  }
  if (typeof thrown !== "string") return thrown;
  const error = new Error(thrown);
  error.name = name;
  return error;
}

/** Runs `call`, rethrowing a Rust error string as an `Error` named `name`. */
function named<T>(name: string, call: () => T): T {
  try {
    return call();
  } catch (thrown) {
    throw asError(thrown, name);
  }
}

/* Records ------------------------------------------------------------------ */

/** A new experiment. Throws `ExperimentValidationError` for a blank name. */
export function createExperiment<I, E>(input: I, deps: { clock: { nowIso(): string }; ids: { newId(): string } }): E {
  const now = deps.clock.nowIso();
  const id = deps.ids.newId();
  return named("ExperimentValidationError", () => rawCreateExperimentWith(input, id, now) as E);
}

/** A new reading list. Throws `ReadingListValidationError` for a blank name. */
export function createReadingList<I, L>(input: I, deps: { clock: { nowIso(): string }; ids: { newId(): string } }): L {
  const id = deps.ids.newId();
  const now = deps.clock.nowIso();
  return named("ReadingListValidationError", () => rawCreateReadingListWith(input, id, now) as L);
}

/** A new vault page. Throws `VaultPageValidationError` for a blank title. */
export function createVaultPage<I, P>(input: I, deps: { clock: { nowIso(): string }; ids: { newId(): string } }): P {
  const now = deps.clock.nowIso();
  const id = deps.ids.newId();
  return named("VaultPageValidationError", () => rawCreateVaultPageWith(input, id, now) as P);
}

/** A page-tree node holding the caller's own page type (Rust sends { id } pages). */
interface PageNode<P> {
  page: P;
  children: PageNode<P>[];
}

/** Pages nested by `parentId`, each level sorted; nodes hold the caller's own page objects. */
export function buildPageTree<P extends { id: string }>(pages: readonly P[]): PageNode<P>[] {
  const byId = new Map<string, P>();
  for (const page of pages) byId.set(page.id, page);
  const restore = (node: PageNode<{ id: string }>): PageNode<P> => ({
    page: byId.get(node.page.id)!,
    children: node.children.map(restore),
  });
  return (rawBuildPageTree([...pages]) as PageNode<{ id: string }>[]).map(restore);
}

/** The stored graph state, or the defaults when nothing is stored. */
export function mergeGraphPersistedState<S>(stored: S | null): S {
  return rawMergeGraphPersistedState(stored) as S;
}

/** The latest screening verdict for each item. */
export function verdictsFor<V>(items: readonly { id: string }[], decisions: readonly unknown[]): V[] {
  return rawVerdictsFor(JSON.stringify(items), JSON.stringify(decisions)) as V[];
}

/** The label shown for a member's role. */
export function memberRoleLabel(member: { role: string }, opts: { inLab: boolean; ownsOrg?: boolean }): string {
  return rawMemberRoleLabelOf(member, opts.inLab, opts.ownsOrg ?? false) ?? "";
}

/* AI ----------------------------------------------------------------------- */

/** A 16-character nonce for fencing untrusted context, from `random`. */
export function contextNonce(random: () => number = Math.random): string {
  return contextNonceFrom(Array.from({ length: 16 }, () => random()));
}

/** Lint findings for a wiki: duplicates, near duplicates, broken links, orphans. */
export function lintWiki<R>(pages: readonly unknown[], otherTitles: readonly string[] = []): R {
  return rawLintWiki([...pages], [...otherTitles]) as R;
}

/** The lint findings grouped into ordered fix steps. */
export function planFixOrder<S>(report: unknown): S[] {
  return rawPlanFixOrder(report) as S[];
}

/* Ink pages ---------------------------------------------------------------- */

/** The value at `index`, or the first value when out of range. */
export function inkEnumValue<T extends string>(values: readonly T[], index: number): T {
  return rawInkEnumValue([...values], index) as T;
}

/** A stroke with defaults filled and widths clamped. */
export function makeInkStroke<S>(input: { points: readonly number[] }): S {
  return rawMakeInkStroke(input) as S;
}

/** An empty A4 page on `paper`. */
export function blankInkPage<P>(paper = "blank"): P {
  return rawBlankInkPage(paper) as P;
}

/** The strokes of one recognised line. */
export function inkLineStrokes<S>(strokes: readonly S[], line: { strokeStart: number; strokeCount: number }): S[] {
  return rawInkLineStrokes([...strokes], line) as S[];
}

/* Ink paths ---------------------------------------------------------------- */

/** The sidecar folder of an ink note. Throws for an unusable id. */
export function inkSidecarDir(noteId: string): string {
  return named("Error", () => rawInkSidecarDir(noteId));
}

/** The file of one ink chunk. Throws for an unusable note or chunk id. */
export function inkChunkPath(noteId: string, chunkId: string): string {
  return named("Error", () => rawInkChunkPath(noteId, chunkId));
}

/** The note and chunk ids of a chunk path, or null for any other path. */
export function parseInkChunkPath(path: string): { noteId: string; chunkId: string } | null {
  return (rawParseInkChunkPath(path) as { noteId: string; chunkId: string } | null | undefined) ?? null;
}

function defaultRandomBytes(target: Uint8Array): void {
  const webCrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (webCrypto?.getRandomValues) {
    webCrypto.getRandomValues(target);
    return;
  }
  for (let i = 0; i < target.length; i += 1) target[i] = Math.floor(Math.random() * 256);
}

/** A fresh chunk id: a ULID from the time and ten random bytes. */
export function newInkChunkId(
  options: { now?: number; randomBytes?: (target: Uint8Array) => void } = {},
): string {
  const now = options.now ?? Date.now();
  const bytes = new Uint8Array(10);
  (options.randomBytes ?? defaultRandomBytes)(bytes);
  return named("Error", () => rawNewInkChunkId(now, bytes));
}

/* Ink engines -------------------------------------------------------------- */

/** The declared facts about an engine, or null for an unknown id. */
export function inkEngineInfo<I>(id: string): I | null {
  return (rawInkEngineInfo(id) as I | null | undefined) ?? null;
}

/* Page titles -------------------------------------------------------------- */

/** The best title a page's HTML offers, or null. */
export function extractPageTitle(html: string): { title: string; suspect: boolean } | null {
  return (rawExtractPageTitle(html) as { title: string; suspect: boolean } | null | undefined) ?? null;
}

/* Folder layout ------------------------------------------------------------ */

/** The entity type a file's `.kind.md` suffix names, or null. */
export function parseKindSuffix<T extends string>(path: string): T | null {
  return (rawParseKindSuffix(path) as T | null | undefined) ?? null;
}

/** The flat path of an entity file. */
export function flatPath(type: string, id: string, title: string, projectRoot = ""): string {
  return rawFlatPath(type, id, title, projectRoot);
}

/** The path of a log entry, filed by year and month. */
export function logPath(id: string, entryDate: string, projectRoot = ""): string {
  return rawLogPath(id, entryDate, projectRoot);
}

/** Where a paper's PDF is kept. */
export function paperPdfPath(paperId: string, projectRoot = ""): string {
  return rawPaperPdfPath(paperId, projectRoot);
}

/** Where a paper's full-text web page is kept. */
export function paperHtmlPath(paperId: string, projectRoot = ""): string {
  return rawPaperHtmlPath(paperId, projectRoot);
}

/** A new experiment with the given id and time (Rust `create_experiment`); throws a Rust error string. */
export function createExperimentWith<I, E>(input: I, id: string, now: string): E {
  return rawCreateExperimentWith(input, id, now) as E;
}

/** A new reading list with the given id and time (Rust `create_reading_list`); throws a Rust error string. */
export function createReadingListWith<I, L>(input: I, id: string, now: string): L {
  return rawCreateReadingListWith(input, id, now) as L;
}

/** A new vault page with the given id and time (Rust `create_vault_page`); throws a Rust error string. */
export function createVaultPageWith<I, P>(input: I, id: string, now: string): P {
  return rawCreateVaultPageWith(input, id, now) as P;
}

