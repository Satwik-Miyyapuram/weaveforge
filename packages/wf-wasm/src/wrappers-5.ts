/**
 * Typed wrappers over the raw wasm exports, folded from 24 one-module files:
 * overleaf-export-path, overleaf-link, overleaf-sync-status, overleaf-text-ot, page-background,
 * pane-tree, paper-note-append, paper-primary-ref, paper-relation, paper-rows,
 * papers-annotation-pin, papers-bib-import, papers-compute-rollup, papers-merge,
 * papers-open-access, papers-preview, papers-reading-digest, papers-records, papers-text,
 * papers-zotero-annotations, paste-text, pdf-cache-eviction, pdf-pages, plan-screen.
 */
import {
  activeTab as rawActiveTab,
  activeTabKey as rawActiveTabKey,
  activeTabRef as rawActiveTabRef,
  appendPaperNote as rawAppendPaperNote,
  applyTextOp as rawApplyTextOp,
  assertSafeExportPath as rawUnsafeExportPathError,
  checkOverleafLinkFolder as rawCheckOverleafLinkFolder,
  citeKeyOf as rawCiteKeyOf,
  cleanArxivId as rawCleanArxivId,
  cleanPmcid as rawCleanPmcid,
  coercePaperFieldValue as rawCoercePaperFieldValue,
  commandForChord as rawCommandForChord,
  computeRollupsForPapers as rawComputeRollupsForPapers,
  createPaperRelationWith as rawCreatePaperRelationWith,
  describeOverleafStatus as rawDescribeOverleafStatus,
  emptyToNull as rawEmptyToNull,
  hydrateTabModes as rawHydrateTabModes,
  imagesOf as rawImagesOf,
  layoutForCommand as rawLayoutForCommand,
  layoutForTabMenu as rawLayoutForTabMenu,
  leaves as rawLeaves,
  missingFigureWarning as rawMissingFigureWarning,
  moveTab as rawMoveTab,
  normalizePasteSettings as rawNormalizePasteSettings,
  normalizeSelectOptions as rawNormalizeSelectOptions,
  openTab as rawOpenTab,
  openTabKeys as rawOpenTabKeys,
  paperRelationInputError as rawPaperRelationInputError,
  parseOverleafLinks as rawParseOverleafLinks,
  parseRollupOptions as rawParseRollupOptions,
  pasteLandsInVerbatimContext as rawPasteLandsInVerbatimContext,
  previewSource as rawPreviewSource,
  primaryPaperRef as rawPrimaryPaperRef,
  pruneLayout as rawPruneLayout,
  resolveArxivId as rawResolveArxivId,
  resolveRelatedPaperUrl as rawResolveRelatedPaperUrl,
  sortByDue as rawSortByDue,
  splitPane as rawSplitPane,
  tabAt as rawTabAt,
  tabKey as rawTabKey,
  togglePreview as rawTogglePreview,
  transformTextOps as rawTransformTextOps,
  zoteroItemKey as rawItemKey,
  zoteroKeyOf as rawZoteroKeyOf,
  zoteroNoteFromItem as rawNoteFromItem,
  zoteroPickMainPdf as rawPickMainPdf,
} from "../pkg/wf_wasm.js";
import type {
  AnnotationPin,
  AnnotationPinRow,
  CachedPdfAge,
  DigestMark,
  DocumentMode,
  DropEntry as PdfDropEntry,
  KeyChord,
  MergePaper,
  Milestone,
  NewPaperRelationInput,
  PageSelection,
  PaneCommand,
  PaneLayout,
  PaneLeaf,
  Paper,
  PaperFieldKind,
  PaperFieldRollupConfig,
  PaperFieldValueData,
  PaperPreview,
  PaperRef,
  PaperRelation,
  PaperRelationRow,
  PasteSettings,
  PdfDropSummary,
  Placement,
  ReadingMark,
  ReadingPaper,
  RelationType,
  RollupFieldDef,
  RollupValue,
  SplitDirection,
  TabMenuCommand,
  TabRef,
  TextComponent,
  TitledBy as PdfDropTitledBy,
  ZoteroAnnotation,
  ZoteroItemRow,
} from "./bindings.js";

export {
  activateTab,
  annotationIdentity,
  annotationPinToDomain,
  applyCommaPlacement,
  arxivCandidates,
  arxivStamp,
  bibImportMessage,
  bibPaperInput,
  checkNewPaper,
  cleanPastedText,
  cleanPdfText,
  cleanUrlsWithRules,
  cleanWrappedText,
  closedTabs,
  closeTab,
  createPaperRelationWith,
  defaultPasteSettings,
  draftReadingLog,
  emptyLayout,
  encodeRollupOptions,
  escapeLinkLabel,
  extractHashtagRefs,
  extractHashtags,
  focusedTabCount,
  focusPane,
  guessTitle,
  highlightsDigest,
  isAllPages,
  isBareUrl,
  isBibFile,
  isEmptyPaperSummary,
  isPaperFieldKind,
  isPdfFile,
  isPdfTooLarge,
  isQuotationType,
  knownCandidates,
  layoutFromRecord,
  leaves,
  linkLabel,
  markdownLink,
  mergePaperInto,
  metadataTitle,
  normalizeDoi,
  normalizeFieldName,
  normalizeTags,
  pageListProblem,
  paperFieldDefRowToDomain,
  paperFieldValueRowToDomain,
  paperImageThumbnailPath,
  paperRowToDomain,
  paperRowToSummary,
  paperToRow,
  parseBiorxiv,
  parseDoaj,
  parseEuropePmc,
  parseHal,
  parseLinkRemovalText,
  parseOpenalex,
  parsePageList,
  parseSemanticScholar,
  parseUnpaywall,
  parseZenodo,
  pickKeysToEvict,
  placeOnSheet,
  planBibImport,
  planEyebrow,
  pmcCandidates,
  preprintServerFor,
  previewOpen,
  previewReaderHref,
  previewTab,
  rankOpenAccessCandidates,
  selectedPdfPages,
  setRatio,
  setTabMode,
  siteOf,
  splitPaperDrop,
  summarizePdfDrop,
  tabKey,
  tabMode,
  tabSeparatedToMarkdownTable,
  zenodoRecordId,
  zoteroAnnotationFromItem,
  zoteroIsPdfAttachment,
} from "../pkg/wf_wasm.js";
export type {
  BibImportPaper,
  BibImportPlan,
  BibImportSkip,
  EuropePmcAnswer,
  MergePaper,
  OpenAccessCandidate,
  OpenAccessFormat,
  OpenAccessSource,
  RollupFieldDef,
  RollupValue,
  ZoteroAnnotation,
  ZoteroAnnotationKind,
  ZoteroAnnotationPosition,
  ZoteroItemData,
  ZoteroItemRow,
  ZoteroTagRow,
} from "./bindings.js";

// --- overleaf-export-path ---
/**
 * Export path guard and missing-figure warning (Rust `overleaf::export_path`), re-exported from
 * index.ts. The guard throws, as the TS helper it replaces did.
 */
/** Throws unless `path` is a plain relative ZIP entry name: no `..`, no leading `/`, no `\`. */
export function assertSafeExportPath(path: string): void {
  const error = rawUnsafeExportPathError(path);
  if (error) throw new Error(error);
}

/** The warning for a figure whose blob could not be loaded. */
export function missingFigureWarning(img: { zipPath: string; storagePath: string }): string {
  return rawMissingFigureWarning(img.zipPath, img.storagePath);
}

// --- overleaf-link ---
/**
 * Overleaf link rules (Rust `overleaf_link`), re-exported from index.ts. The types mirror the Rust
 * structs; they are not in bindings.ts yet.
 */
/** One Overleaf project linked to a vault folder. */
export interface OverleafLinkRow {
  projectId: string;
  /** Vault-relative, forward slashes. */
  folder: string;
}

/** Whether a vault folder may be linked: the normalised folder, or the reason it may not. */
export type OverleafLinkFolderCheck = { ok: true; folder: string } | { ok: false; reason: string };

/** Check a vault-relative folder. A non-string is refused, as the Rust side takes only strings. */
export function checkOverleafLinkFolder(raw: unknown): OverleafLinkFolderCheck {
  if (typeof raw !== "string") {
    return { ok: false, reason: "Choose a folder inside the vault, like Overleaf/thesis." };
  }
  return rawCheckOverleafLinkFolder(raw) as OverleafLinkFolderCheck;
}

/** The well-formed links in stored JSON. A non-string value gives no links. */
export function parseOverleafLinks(stored: unknown): OverleafLinkRow[] {
  if (typeof stored !== "string") return [];
  return rawParseOverleafLinks(stored) as OverleafLinkRow[];
}

// --- overleaf-sync-status ---
/**
 * Overleaf sync status line (Rust `overleaf::sync_status`), re-exported from index.ts.
 */
export interface OverleafSyncStatus {
  url?: string | null;
  branch: string;
  ahead: number;
  behind: number;
}

/** The one-line status for the Overleaf sync panel. Returns `""` when no status is given. */
export function describeOverleafStatus(status: OverleafSyncStatus | null | undefined): string {
  return rawDescribeOverleafStatus(status ?? null);
}

// --- overleaf-text-ot ---
/**
 * ShareJS text ops, the format Overleaf's editor speaks (Rust `overleaf::text_ot`),
 * re-exported from index.ts. Errors are thrown as `Error`, as the TS port did.
 */
export type { TextComponent };

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** `text` with `op` applied. Throws when a delete does not match the text it removes. */
export function applyTextOp(text: string, op: TextComponent[]): string {
  try {
    return rawApplyTextOp(text, op);
  } catch (error) {
    throw asError(error);
  }
}

/** Both ops rewritten so each applies after the other: `left` is ours, `right` the server's. */
export function transformTextOps(
  left: TextComponent[],
  right: TextComponent[],
): [TextComponent[], TextComponent[]] {
  try {
    return rawTransformTextOps(left, right) as [TextComponent[], TextComponent[]];
  } catch (error) {
    throw asError(error);
  }
}

// --- page-background ---
/**
 * Where a page background sits on the A4 sheet (Rust `ink::page_background`),
 * re-exported from index.ts.
 */
export type { Placement };

// --- pane-tree ---
/**
 * Pane layout (Rust `editor_workspace::pane_tree`), re-exported from index.ts.
 * The app's call shapes are kept here: callbacks become key lists, and new
 * pane ids are generated in this glue, since the raw exports take them as input.
 */
/** Kind of the preview tab (Rust `PREVIEW_KIND`). */
const PREVIEW_KIND = "preview";

let paneCounter = 0;
/** A pane id unique within this session; the glue passes it to the raw calls that create panes. */
function nextPaneId(): string {
  paneCounter += 1;
  return `pane-${Date.now().toString(36)}-${paneCounter}`;
}

/** True for the preview tab, which is one tab not tied to a document. */
export function isPreviewTab(tab?: TabRef): boolean {
  return tab?.kind === PREVIEW_KIND;
}

export function openTab(layout: PaneLayout, tab: TabRef, paneId = layout.focusedPaneId): PaneLayout {
  return rawOpenTab(layout, tab, paneId) as PaneLayout;
}

export function splitPane(
  layout: PaneLayout,
  paneId: string,
  direction: SplitDirection,
  newPaneId = nextPaneId(),
): PaneLayout {
  return rawSplitPane(layout, paneId, direction, newPaneId) as PaneLayout;
}

/** Move a tab; `toIndex` is the slot on a tab drop, or omitted to append on a pane drop. */
export function moveTab(
  layout: PaneLayout,
  from: { paneId: string; index: number },
  toPaneId: string,
  toIndex?: number,
): PaneLayout {
  return rawMoveTab(layout, from.paneId, from.index, toPaneId, toIndex) as PaneLayout;
}

export function activeTab(leaf: PaneLeaf): TabRef | undefined {
  return (rawActiveTab(leaf) ?? undefined) as TabRef | undefined;
}

export function activeTabRef(layout: PaneLayout): TabRef | undefined {
  return (rawActiveTabRef(layout) ?? undefined) as TabRef | undefined;
}

export function activeTabKey(layout: PaneLayout): string | undefined {
  return rawActiveTabKey(layout) ?? undefined;
}

export function tabAt(layout: PaneLayout, paneId: string, index: number): TabRef | undefined {
  return (rawTabAt(layout, paneId, index) ?? undefined) as TabRef | undefined;
}

export function togglePreview(layout: PaneLayout, newPaneId = nextPaneId()): PaneLayout {
  return rawTogglePreview(layout, newPaneId) as PaneLayout;
}

/** The document the preview shows: the focused tab, or `previous` when the focus is on the preview itself. */
export function previewSource(layout: PaneLayout, previous?: TabRef): TabRef | undefined {
  return (rawPreviewSource(layout, previous) ?? undefined) as TabRef | undefined;
}

/** The key of every tab open in any pane. */
export function openTabKeys(layout: PaneLayout): Set<string> {
  return new Set(rawOpenTabKeys(layout) as string[]);
}

/** The fields of a key press that a chord reads (a DOM `KeyboardEvent` also fits). */
export type { KeyChord };

/**
 * The workspace command a chord means (Rust `keybindings::command_for_chord`).
 * The fields are copied out first: a DOM event keeps its modifiers on prototype getters.
 * `tabCount` defaults to unbounded.
 */
export function commandForChord(chord: KeyChord, tabCount = Infinity): string | null {
  const plain = {
    key: chord.key,
    code: chord.code ?? null,
    ctrlKey: chord.ctrlKey ?? false,
    metaKey: chord.metaKey ?? false,
    shiftKey: chord.shiftKey ?? false,
    altKey: chord.altKey ?? false,
  };
  const count = Number.isFinite(tabCount) ? tabCount : undefined;
  return (rawCommandForChord(plain, count) ?? null) as string | null;
}

export function layoutForCommand(
  layout: PaneLayout,
  command: PaneCommand,
  newPaneId = nextPaneId(),
): PaneLayout {
  return sameOr(layout, rawLayoutForCommand(layout, command, newPaneId) as PaneLayout);
}

export function layoutForTabMenu(
  layout: PaneLayout,
  paneId: string,
  index: number,
  command: TabMenuCommand,
  newPaneId = nextPaneId(),
): PaneLayout {
  return sameOr(layout, rawLayoutForTabMenu(layout, paneId, index, command, newPaneId) as PaneLayout);
}

/** `before` itself when Rust returned an equal layout, so `next === layout` means "no change". */
function sameOr(before: PaneLayout, after: PaneLayout): PaneLayout {
  return JSON.stringify(before) === JSON.stringify(after) ? before : after;
}

/**
 * Drop tabs for which `exists` is false, then collapse whatever that empties.
 * Preview tabs are always kept, as the raw call does.
 */
export function pruneLayout(layout: PaneLayout, exists: (tab: TabRef) => boolean): PaneLayout {
  const open = new Set<string>();
  for (const leaf of rawLeaves(layout.root) as PaneLeaf[]) {
    for (const tab of leaf.tabs) {
      if (exists(tab)) open.add(rawTabKey(tab));
    }
  }
  return rawPruneLayout(layout, [...open]) as PaneLayout;
}

/**
 * Stamp `modeFor(tab)` onto every tab that has no mode yet. A tab that already
 * carries a mode is left alone. Returns `layout` itself when nothing changes.
 */
export function hydrateTabModes(
  layout: PaneLayout,
  modeFor: (tab: TabRef) => DocumentMode,
): PaneLayout {
  const modes: Record<string, DocumentMode> = {};
  for (const leaf of rawLeaves(layout.root) as PaneLeaf[]) {
    for (const tab of leaf.tabs) {
      if (tab.mode == null) modes[rawTabKey(tab)] = modeFor(tab);
    }
  }
  if (Object.keys(modes).length === 0) return layout;
  return rawHydrateTabModes(layout, modes) as PaneLayout;
}

// --- paper-note-append ---
/**
 * Paper note appending (Rust `paper_note::append_paper_note`), re-exported from index.ts. Keeps
 * the result of packages/core/src/features/ai-assistant/domain/parts.ts.
 */
/** The note with `addition` after a blank line; `undefined` when the addition is blank. */
export function appendPaperNote(existing: string | undefined, addition: string): string | undefined {
  return rawAppendPaperNote(existing, addition) ?? undefined;
}

// --- paper-primary-ref ---
/**
 * Primary external id of a stored paper (Rust `papers::paper_ref::primary_paper_ref`), re-exported
 * from index.ts. Keeps the `paperRef` result of
 * packages/core/src/features/relations/application/paper-ref.ts.
 */
/** The arXiv id, else the DOI, else null. A blank value counts as unset. */
export function primaryPaperRef(
  arxivId: string | null | undefined,
  doi: string | null | undefined,
): PaperRef | null {
  return (rawPrimaryPaperRef(arxivId ?? undefined, doi ?? undefined) ?? null) as PaperRef | null;
}

// --- paper-relation ---
/**
 * Paper relation domain rules (Rust `paper_relation`), re-exported from index.ts.
 * Each function keeps the signature of packages/core/src/features/relations/domain/parts.ts.
 */
export type { PaperRelationRow };

export const RELATION_TYPES: readonly RelationType[] = [
  "cites",
  "extends",
  "contradicts",
  "similar",
  "builds_on",
  "uses_method",
];

/** The validation message for relation input, if it is invalid. */
export function paperRelationInputError(input: NewPaperRelationInput): string | undefined {
  // An unknown type would fail to deserialize in Rust; report it as the TS rule did.
  if (!RELATION_TYPES.includes(input.relation)) return `Unknown relation "${input.relation}".`;
  return rawPaperRelationInputError(input);
}

/** A new relation from caller input. Throws `PaperRelationValidationError` before drawing an id. */
export function createPaperRelation(
  input: NewPaperRelationInput,
  deps: { clock: { nowIso(): string }; ids: { newId(): string } },
): PaperRelation {
  const message = paperRelationInputError(input);
  if (message != null) {
    const error = new Error(message);
    error.name = "PaperRelationValidationError";
    throw error;
  }
  const id = deps.ids.newId();
  const now = deps.clock.nowIso();
  return rawCreatePaperRelationWith(input, id, now);
}

// --- paper-rows ---
/**
 * Paper, paper field and annotation quotation type row mapping (Rust `papers::paper_row`,
 * `papers::paper_field_row` and `papers::annotation_quotation_type_row`). The rows are the
 * tables' columns; the domain types are camelCase. The repositories that read and write them
 * stay in the web app.
 */
/** The text, or `null` when it is absent or empty. */
export function emptyToNull(value: string | null | undefined): string | null {
  return rawEmptyToNull(value ?? undefined) as string | null;
}

// --- papers-annotation-pin ---
/**
 * Annotation pin row to domain pin (Rust `papers::annotation_pin`), re-exported
 * from index.ts.
 */
export type { AnnotationPin, AnnotationPinRow };

// --- papers-bib-import ---
/**
 * `.bib` import (Rust `papers::bib_import`), re-exported from index.ts.
 */
/** The fields a new paper takes from a planned entry, as the add call reads them. */
export type BibPaperInputRow = {
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  doi?: string;
  arxivId?: string;
  url?: string;
  abstract?: string;
  bibtex: string;
  metadata: { citeKey: string };
};

/** The citation key of a paper's metadata bag, when it is a string that is not blank. */
export function citeKeyOf(metadata: unknown): string | undefined {
  return (rawCiteKeyOf(metadata) as string | undefined) ?? undefined;
}

// --- papers-compute-rollup ---
/**
 * Rollup columns (Rust `papers::compute_rollup::compute_rollup_for_papers`).
 * Re-exported from index.ts. One call per rollup column: the values cross into wasm once
 * for all listed papers, so a table does not serialize them per cell.
 */
/** Options are optional here; a def without them reads as having none. */
function withOptions(
  def: Omit<RollupFieldDef, "options"> & { options?: readonly string[] },
): RollupFieldDef {
  return { ...def, options: [...(def.options ?? [])] };
}

/**
 * Each listed paper's value for `rollup`, in `paperIds` order. `null` where the rollup has
 * no value for that paper.
 */
export function computeRollupsForPapers(
  paperIds: readonly string[],
  rollup: Omit<RollupFieldDef, "options"> & { options?: readonly string[] },
  defs: readonly (Omit<RollupFieldDef, "options"> & { options?: readonly string[] })[],
  values: readonly RollupValue[],
): (PaperFieldValueData | null)[] {
  return rawComputeRollupsForPapers(
    paperIds,
    withOptions(rollup),
    defs.map(withOptions),
    values,
  ) as (PaperFieldValueData | null)[];
}

// --- papers-merge ---
/**
 * Merging a duplicate paper into the copy kept (Rust `papers::paper_merge`). Re-exported
 * from index.ts. The type is generated from Rust into bindings.ts.
 */
/** The Zotero item key in a paper's metadata bag, or undefined when there is none. */
export function zoteroKeyOf(metadata: Record<string, unknown> | null | undefined): string | undefined {
  return (rawZoteroKeyOf(metadata ?? undefined) as string | null) ?? undefined;
}

// --- papers-open-access ---
/**
 * Open-access lookup (Rust `papers::open_access`). Re-exported from index.ts. The types are
 * generated from Rust into bindings.ts. Fetching the indexes stays in TypeScript.
 */
/** The arXiv id in a cleaned form, or undefined. */
export function cleanArxivId(id: string | null | undefined): string | undefined {
  return rawCleanArxivId(id ?? undefined) ?? undefined;
}

/** The PMCID in a cleaned form, or undefined. */
export function cleanPmcid(id: string | null | undefined): string | undefined {
  return rawCleanPmcid(id ?? undefined) ?? undefined;
}

/** The arXiv id to ask about, from the arXiv id or the DOI. */
export function resolveArxivId(arxivId: string | null | undefined, doi: string | null | undefined): string | undefined {
  return rawResolveArxivId(arxivId ?? undefined, doi ?? undefined) ?? undefined;
}

// --- papers-preview ---
/**
 * Paper preview frame: the reader link and the saved page's site (Rust
 * `papers::paper_preview`), re-exported from index.ts.
 */
export type { PaperPreview };

// --- papers-reading-digest ---
/**
 * Reader-mark digest and reading log (Rust `papers::reading_digest`), re-exported
 * from index.ts.
 */
export type { DigestMark, ReadingMark, ReadingPaper };

// --- papers-records ---
/**
 * Paper record rules (Rust `papers::paper`, `papers::paper_field`, `papers::annotation_quotation_type`),
 * re-exported from index.ts. Each function keeps the signature of the TS file of the same name in
 * packages/core/src/features/papers/domain.
 */
/** The page a related-paper hit links to: its url, else its DOI link, else its arXiv page. */
export function resolveRelatedPaperUrl(hit: {
  url?: string;
  doi?: string;
  arxivId?: string;
}): string | undefined {
  return rawResolveRelatedPaperUrl(hit.url, hit.doi, hit.arxivId);
}

/** Storage paths of a paper's attached images (`metadata.images`); empty when absent. */
export function imagesOf(metadata: Record<string, unknown> | null | undefined): string[] {
  return rawImagesOf(metadata ?? null);
}

/** Select options trimmed, blanks dropped, and case-insensitive repeats removed (first spelling wins). */
export function normalizeSelectOptions(raw: readonly string[]): string[] {
  return rawNormalizeSelectOptions([...raw]);
}

/** The rollup config stored in a field's options, or null when they hold none. */
export function parseRollupOptions(options: readonly string[]): PaperFieldRollupConfig | null {
  return (rawParseRollupOptions([...options]) as PaperFieldRollupConfig | null) ?? null;
}

/**
 * The value a field stores for `raw` (null or blank clears it, `null` is returned). Throws with the
 * refusal message for a wrong shape or a rollup field.
 */
export function coercePaperFieldValue(
  kind: PaperFieldKind,
  raw: PaperFieldValueData | null | undefined,
): PaperFieldValueData | null {
  return (rawCoercePaperFieldValue(kind, raw ?? null) as PaperFieldValueData | null) ?? null;
}

// --- papers-text ---
/**
 * Paper drop rules, PDF titles and figure names (Rust `papers::paper_drop`,
 * `papers::paper_image`), re-exported from index.ts.
 */
export type { PdfDropEntry, PdfDropSummary, PdfDropTitledBy };

/** Where each dropped file goes, as indices into the drop: `.bib` files are imported, the rest take the PDF path. */
export interface PaperDropSplit {
  pdfIndices: number[];
  bibIndices: number[];
}

// --- papers-zotero-annotations ---
/**
 * Zotero annotation and note rows (Rust `papers::zotero_annotations`). Re-exported
 * from index.ts. The types are generated from Rust into bindings.ts.
 */
/** The item's key from the top level or `data`, or undefined. */
export function zoteroItemKey(item: ZoteroItemRow): string | undefined {
  return rawItemKey(item) ?? undefined;
}

/** The paper's main PDF key among its PDF attachments, or undefined. */
export function zoteroPickMainPdf(pdfs: readonly ZoteroItemRow[]): string | undefined {
  return rawPickMainPdf(pdfs) ?? undefined;
}

/** A note row as the app caches it, or undefined when its text is empty. */
export function zoteroNoteFromItem(item: ZoteroItemRow): ZoteroAnnotation | undefined {
  return rawNoteFromItem(item) ?? undefined;
}

// --- paste-text ---
/**
 * Paste and text clean-up (Rust `paste`), re-exported from index.ts.
 */
/** Whether a paste at UTF-16 `offset` lands in code or frontmatter (Rust `paste_lands_in_verbatim_context`). */
export function pasteLandsInVerbatimContext(document: string, offset: number): boolean {
  return rawPasteLandsInVerbatimContext(document, Math.max(0, Math.floor(offset)));
}

/** Settings the pipeline can trust from whatever was stored (Rust `normalize_paste_settings`). */
export function normalizePasteSettings(raw: unknown): PasteSettings {
  const json = JSON.stringify(raw) ?? "null";
  return rawNormalizePasteSettings(json) as PasteSettings;
}

// --- pdf-cache-eviction ---
/**
 * The IndexedDB PDF cache's eviction choice (Rust `reader::pdf_cache_eviction`),
 * re-exported from index.ts.
 */
export type { CachedPdfAge };

// --- pdf-pages ---
/**
 * Which pages of a PDF the user meant: `all`, or a list like `1,3-5` (Rust
 * `ink::pdf_pages`), re-exported from index.ts.
 */
export type { PageSelection };

// --- plan-screen ---
/**
 * Plan screen ordering and summary text (Rust `plan::screen`), re-exported from index.ts.
 */
/** Dated milestones soonest first, undated ones after. Stable. Rust reads only `targetDate`. */
export function sortByDue<M extends Pick<Milestone, "targetDate">>(milestones: readonly M[]): M[] {
  return rawSortByDue(milestones) as M[];
}
