import {
  LexicalConceptExtractor,
  buildWikiIndex,
  lintWiki,
  mergeWikiPages,
  planFixOrder,
  planWikiPages,
  replaceWikiIndex,
  type ExtractionDocument,
  type IConceptExtractor,
  type LintReport,
  type MergeResult,
  type WikiPageRef,
  type WikiPagePlan,
} from "@thesis/core";
import { getContainer } from "@/bootstrap";
import { modelExtractor } from "@/features/ai-assistant/application/ai-provider-session";

/**
 * Driving concept extraction and wiki maintenance from the app.
 *
 * Nothing here writes. Extraction produces a *plan*, and every page in it goes
 * through the existing proposal queue for human review — the same gate as any
 * other assistant write. That is deliberate: an auto-generated wiki that
 * appears without asking is the failure mode that makes people distrust the
 * whole feature.
 */

/** Notes and papers are the source material; generated pages are excluded. */
export const WIKI_ROOT_TITLE = "Wiki";

export async function wikiSourceDocuments(
  /** Restrict to these ids. Omitted means every note and paper. */
  sourceIds?: readonly string[],
): Promise<ExtractionDocument[]> {
  const snapshot = await getContainer().workspace.snapshot();
  const wikiRoot = snapshot.vaultPages.find((page) => page.title === WIKI_ROOT_TITLE);
  const generated = new Set(
    wikiRoot ? snapshot.vaultPages.filter((p) => p.parentId === wikiRoot.id).map((p) => p.id) : [],
  );
  const wanted = sourceIds ? new Set(sourceIds) : null;
  const chosen = (id: string) => !wanted || wanted.has(id);

  return [
    // Extracting from generated pages would feed the wiki its own output and
    // amplify whatever it got wrong on the first pass.
    ...snapshot.vaultPages
      .filter((page) => !generated.has(page.id) && chosen(page.id))
      .map((page) => ({ id: page.id, title: page.title, text: page.body })),
    ...snapshot.papers.filter((paper) => chosen(paper.id)).map((paper) => ({
      id: paper.id,
      title: paper.title,
      text: [paper.abstract, paper.summary].filter(Boolean).join("\n\n"),
    })),
  ];
}

/** Pages already in the wiki, for dedupe and lint. */
export async function existingWikiPages(): Promise<WikiPageRef[]> {
  const snapshot = await getContainer().workspace.snapshot();
  const wikiRoot = snapshot.vaultPages.find((page) => page.title === WIKI_ROOT_TITLE);
  if (!wikiRoot) return [];
  return snapshot.vaultPages
    .filter((page) => page.parentId === wikiRoot.id)
    .map((page) => ({ id: page.id, title: page.title, body: page.body }));
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
export function defaultExtractor(): IConceptExtractor {
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
  const documents = await wikiSourceDocuments(sourceIds);
  const existing = await existingWikiPages();
  const titles = existing.map((page) => page.title);

  const extraction = await extractor.extract({
    documents,
    existingConcepts: titles,
    maxConcepts: 200,
  });

  const titleById = new Map(documents.map((doc) => [doc.id, doc.title]));
  const plans = planWikiPages({
    extraction,
    existingTitles: titles,
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
  const snapshot = await container.workspace.snapshot();
  let root = snapshot.vaultPages.find((page) => page.title === WIKI_ROOT_TITLE);
  if (!root) {
    root = await container.vault.manageVaultPage.add({ title: WIKI_ROOT_TITLE });
  }

  let queued = 0;
  for (const plan of plans) {
    await container.aiProposals.draftLocal({
      kind: "create_vault_note",
      resourceId: root.id,
      content: `Create wiki page "${plan.title}" (${plan.mentions} mentions)`,
      payload: { title: plan.title, body: plan.body, parentId: root.id },
      sourceLinks: plan.sourceDocumentIds,
    });
    queued += 1;
  }
  return queued;
}

export async function runWikiLint(): Promise<{ report: LintReport; steps: ReturnType<typeof planFixOrder> }> {
  const report = lintWiki(await existingWikiPages());
  return { report, steps: planFixOrder(report) };
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
  const pages = await existingWikiPages();
  const primary = pages.find((page) => page.id === primaryId);
  const secondary = pages.find((page) => page.id === secondaryId);
  if (!primary || !secondary) return null;

  return {
    primaryTitle: primary.title,
    secondaryTitle: secondary.title,
    result: mergeWikiPages(
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
  container.search.invalidate();
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
  const snapshot = await container.workspace.snapshot();
  const root = snapshot.vaultPages.find((page) => page.title === WIKI_ROOT_TITLE);
  if (!root) throw new Error("There is no wiki yet — scan for concepts first.");

  const pages = await existingWikiPages();
  await container.vault.manageVaultPage.update(root.id, {
    title: root.title,
    body: replaceWikiIndex(root.body, buildWikiIndex(pages)),
  });
  container.search.invalidate();
  return { pages: pages.length };
}

/**
 * Queue the page a dead link points at.
 *
 * The link already says what it wants to exist; the missing half is a page to
 * land on. It goes through review like any other generated page rather than
 * appearing, because "a link mentioned it" is thin evidence that a page is
 * worth having.
 */
export async function proposeMissingPage(target: string): Promise<void> {
  const title = target.trim();
  if (!title) return;

  await proposeWikiPages([
    {
      title,
      body: `# ${title}\n\n_Not written yet._\n`,
      mentions: 1,
      sourceDocumentIds: [],
    },
  ]);
}
