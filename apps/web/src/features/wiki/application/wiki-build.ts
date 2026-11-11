import { LexicalConceptExtractor, planWikiPages, wikiProposalContent, type FixStep, type IConceptExtractor, type LintReport, type MergeResult, type WikiPagePlan } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { modelExtractor } from "@/features/ai-assistant/application/ai-provider-session";
import { readyCore, typedCore } from "@/lib/rust-core";

/**
 * Driving concept extraction and wiki maintenance from the app.
 *
 * Nothing here writes. Extraction produces a *plan*, and every page in it goes
 * through the existing proposal queue for human review — the same gate as any
 * other assistant write. That is deliberate: an auto-generated wiki that
 * appears without asking is the failure mode that makes people distrust the
 * whole feature.
 *
 * The page rules (which note is the root, what counts as a source, dead-link
 * plans, recent pages) are wf-core's `ai::wiki_pages`; this file does the reads
 * and the proposals.
 */

/** The wiki root's title; notes titled this are the wiki (see `ai::wiki_pages`). */
const WIKI_ROOT_TITLE = "Wiki";

/**
 * Notes, with bodies.
 *
 * Deliberately not `workspace.snapshot()`. A snapshot reads every entity in the
 * project — experiments, milestones, log entries, relations, tags, reading
 * lists and their items, reader annotations — which is eleven round trips to
 * answer a question about vault pages. Nothing here has ever looked at any of
 * the other nine collections.
 */
async function notes() {
  return getContainer().vault.listPages();
}

export async function wikiSourceDocuments(
  /** Restrict to these ids. Omitted means every note and paper. */
  sourceIds?: readonly string[],
) {
  const container = getContainer();
  const [pages, papers] = await Promise.all([notes(), container.papers.listPapers()]);
  return readyCore().wikiSourceDocuments(pages, papers, sourceIds);
}

/** Pages already in the wiki, for dedupe and lint. */
async function wikiPageRefsNow() {
  return readyCore().wikiPageRefs(await notes());
}

/**
 * Every note title, wiki or not. A proposed page must not share a title with
 * any note, or its `[[links]]` would point at two notes (E37).
 */
export function takenTitles(pages: readonly { title: string }[]): string[] {
  return pages.map((page) => page.title);
}

export interface WikiBuildPreview {
  plans: WikiPagePlan[];
  /** Concepts found but already covered, so "nothing to do" is explicable. */
  alreadyCovered: number;
  documentsScanned: number;
  /** Which extractor ran, so the result can say where it came from. */
  extractorId: string;
}

/**
 * The extractor a scan will use.
 *
 * Lexical unless the user has pointed at a model. Lexical is not a placeholder:
 * it is deterministic, free, private, and immediate, and for a first pass over
 * a workspace full of hashtags and wikilinks it is often the better answer. A
 * configured model makes the scan better, not possible.
 */
function defaultExtractor(): IConceptExtractor {
  return modelExtractor() ?? new LexicalConceptExtractor();
}

/**
 * Plan the pages worth adding.
 *
 * Takes an extractor so a caller can force one; without an argument it follows
 * whatever the user has configured.
 */
export async function previewWikiBuild(
  extractor: IConceptExtractor = defaultExtractor(),
  /** Ids to read. Omitted scans everything, which is the usual case. */
  sourceIds?: readonly string[],
): Promise<WikiBuildPreview> {
  // One read of the notes answers both questions — what to scan, and what is
  // already covered. Two calls here used to mean two passes over the project.
  const container = getContainer();
  const [pages, papers] = await Promise.all([notes(), container.papers.listPapers()]);
  const core = readyCore();
  const documents = core.wikiSourceDocuments(pages, papers, sourceIds);
  const titles = core.wikiPageRefs(pages).map((page) => page.title);

  const extraction = await extractor.extract({
    documents,
    existingConcepts: titles,
    maxConcepts: 200,
  });

  const titleById = new Map(documents.map((doc) => [doc.id, doc.title]));
  const plans = planWikiPages({
    extraction,
    existingTitles: takenTitles(pages),
    titleOf: (id) => titleById.get(id),
  });

  return {
    plans,
    alreadyCovered: extraction.concepts.length - plans.length,
    documentsScanned: documents.length,
    extractorId: extractor.id,
  };
}

/**
 * Queue the planned pages for review.
 *
 * Uses `create_vault_note`, which already exists end to end — so a generated
 * page is an ordinary note that joins the graph, search, and backlinks with no
 * special handling anywhere.
 */
export async function proposeWikiPages(plans: readonly WikiPagePlan[]): Promise<number> {
  const container = getContainer();
  let root = readyCore().findWikiRoot(await notes());
  if (!root) {
    root = await container.vault.manageVaultPage.add({ title: WIKI_ROOT_TITLE });
  }

  let queued = 0;
  for (const plan of plans) {
    await container.aiProposals.draftLocal({
      kind: "create_vault_note",
      resourceId: root.id,
      content: wikiProposalContent(plan),
      payload: { title: plan.title, body: plan.body, parentId: root.id },
      sourceLinks: plan.sourceDocumentIds,
    });
    queued += 1;
  }
  return queued;
}

export async function runWikiLint(): Promise<{ report: LintReport; steps: FixStep[] }> {
  const [pages, papers] = await Promise.all([notes(), getContainer().papers.listPapers()]);
  // Links to ordinary notes and papers resolve; only wiki pages are linted (E39).
  const outside = [...takenTitles(pages), ...papers.map((paper) => paper.title)];
  const report = typedCore().lintWiki<LintReport>(readyCore().wikiPageRefs(pages), outside);
  return { report, steps: typedCore().planFixOrder<FixStep>(report) };
}

/**
 * Preview a merge of two wiki pages.
 *
 * Preview and apply are separate because merging is lossy: the user has to see
 * what survives, and specifically whether any contradictions were found, before
 * agreeing to it.
 */
export async function previewMerge(
  primaryId: string,
  secondaryId: string,
): Promise<{ primaryTitle: string; secondaryTitle: string; result: MergeResult } | null> {
  const pages = await wikiPageRefsNow();
  const primary = pages.find((page) => page.id === primaryId);
  const secondary = pages.find((page) => page.id === secondaryId);
  if (!primary || !secondary) return null;

  return {
    primaryTitle: primary.title,
    secondaryTitle: secondary.title,
    result: typedCore().mergeWikiPages(
      { id: primary.id, title: primary.title, body: primary.body },
      { id: secondary.id, title: secondary.title, body: secondary.body },
    ),
  };
}

/**
 * Apply a merge: the primary keeps everything, the secondary is removed.
 *
 * Applied directly rather than queued for review, because the user is already
 * reviewing it — they picked the pair and read the merged text. Routing an
 * explicitly confirmed, explicitly previewed action through a second approval
 * queue would be ceremony, not safety.
 *
 * The absorbed title is recorded as an alias in the merged body, so links to
 * the removed page still resolve.
 */
export async function applyMerge(
  primaryId: string,
  secondaryId: string,
  merged: MergeResult,
): Promise<void> {
  const container = getContainer();
  const primary = await container.vault.getPage(primaryId);
  if (!primary) throw new Error("The page being merged into no longer exists.");

  const aliasNote = merged.aliases.length
    ? `\n\n<!-- also known as: ${merged.aliases.join(", ")} -->`
    : "";

  await container.vault.manageVaultPage.update(primary.id, {
    title: merged.title,
    body: `${merged.body}${aliasNote}`,
  });
  await container.vault.manageVaultPage.remove(secondaryId);
}

/**
 * Rewrite the wiki root's index of pages.
 *
 * The index lives in the root note between markers, so anything written around
 * it survives — regeneration is only entitled to the region it generated. It is
 * applied directly rather than queued: it derives entirely from pages that
 * already exist and already passed review, so there is no new claim in it for a
 * reviewer to check.
 */
export async function regenerateWikiIndex(): Promise<{ pages: number }> {
  const container = getContainer();
  const all = await notes();
  const core = readyCore();
  const root = core.findWikiRoot(all);
  if (!root) throw new Error("There is no wiki yet — scan for concepts first.");

  const pages = core.wikiPageRefs(all);
  await container.vault.manageVaultPage.update(root.id, {
    title: root.title,
    body: typedCore().replaceWikiIndex(root.body, typedCore().buildWikiIndex(pages)),
  });
  return { pages: pages.length };
}

/**
 * The pages dead links point at, as plans: one per distinct target.
 *
 * The link already says what it wants to exist; the missing half is a page to
 * land on. Each goes through review like any other generated page rather than
 * appearing, because "a link mentioned it" is thin evidence that a page is
 * worth having. Blank targets are dropped, and a target named twice is one page.
 */
/** Queue every page the dead links point at, in one pass over the wiki. */
export async function proposeMissingPages(targets: readonly string[]): Promise<number> {
  const plans = readyCore().missingPagePlans(targets);
  return plans.length ? proposeWikiPages(plans) : 0;
}

/**
 * The wiki pages most recently written, newest first. A page only exists once
 * its proposal was approved, so its creation time is when it was approved.
 */
export async function recentlyApprovedWikiPages(
  limit = 5,
): Promise<{ id: string; title: string; createdAt: string }[]> {
  return readyCore().recentlyApprovedWikiPages(await notes(), limit);
}
