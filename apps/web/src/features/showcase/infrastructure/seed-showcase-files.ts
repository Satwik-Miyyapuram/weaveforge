/**
 * Writes the showcase thesis into a workspace folder, through the same file
 * repositories the app uses. The docs demo and tests build their workspace with
 * this; nothing here opens a database.
 *
 * Covered: project, papers, relations, report sections, annotation pins, reading
 * lists, experiments with metric curves, paper fields, quotation types,
 * milestones, logbook, vault notes and wiki charts.
 * Not covered: screening decisions (a decision can only be recorded into a list
 * file that already holds the item, and no file repository creates that entry)
 * and supervisor comments (no file repository yet).
 */
import type { IWorkspaceFs } from "@weaveforge/core";
import { wireFileBackend, type FileRepositories } from "@/backend/providers/files/wire-file-backend";
import type { SettingsSection } from "@/backend/providers/files/file-tag-repo";
import type { SecretsStore } from "@/features/settings/infrastructure/parts";
import type { ShowcaseWikiPage } from "../domain/showcase-data";
import {
  SHOWCASE_EXPERIMENTS,
  SHOWCASE_LOG,
  SHOWCASE_MILESTONES,
  SHOWCASE_PAPERS,
  SHOWCASE_PROJECT_COLOR,
  SHOWCASE_PROJECT_NAME,
  SHOWCASE_READING_LISTS,
  SHOWCASE_RELATIONS,
  SHOWCASE_REPORT,
  SHOWCASE_VAULT,
  SHOWCASE_WIKI,
  SHOWCASE_WIKI_ROOT,
  SHOWCASE_ANNOTATION_PINS,
} from "../domain/showcase-data";

/** The arXiv paper the demo reader opens (MAE, CC BY 4.0). */
export const SHOWCASE_PDF_ARXIV_ID = "2111.06377";

export interface SeedShowcaseFilesParts {
  fs: IWorkspaceFs;
  /** The workspace settings file (`MemorySettings` in tests). */
  settings: SettingsSection;
  secrets: SecretsStore;
  /** Bytes of a chart by file name, or null when the chart is not available. */
  readChart: (file: string) => Promise<Uint8Array | null>;
  now?: Date;
}

export interface SeedShowcaseFilesResult {
  projectId: string;
  /** Id of the paper carrying {@link SHOWCASE_PDF_ARXIV_ID}; undefined when absent. */
  pdfPaperId: string | undefined;
}

function isoDate(now: Date, daysAgo: number): string {
  return new Date(now.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

/** Quotation types given to the annotation pins in turn. */
const QUOTATION_TYPES = ["direct", "paraphrase", "summary"] as const;

/** A decaying curve per metric, ending near the experiment's final value. */
function metricCurve(
  experimentId: string,
  finals: Record<string, number>,
): { experimentId: string; metric: string; step: number; value: number }[] {
  const points: { experimentId: string; metric: string; step: number; value: number }[] = [];
  for (const [metric, final] of Object.entries(finals)) {
    for (let step = 0; step < 10; step++) {
      points.push({ experimentId, metric, step, value: Number((final * (1 + 2 / (step + 1))).toFixed(4)) });
    }
  }
  return points;
}

/** Writes the whole showcase thesis into `parts.fs` (rooted at the workspace). */
export async function seedShowcaseFiles(parts: SeedShowcaseFilesParts): Promise<SeedShowcaseFilesResult> {
  const now = parts.now ?? new Date();
  const stamp = now.toISOString();
  // Every row goes into the showcase project's folder, named once it is made.
  let folder = "";
  const repos: FileRepositories = wireFileBackend({
    fs: parts.fs,
    settings: parts.settings,
    secrets: parts.secrets,
    projectRoot: () => folder,
  });

  const project = await repos.projectRepository.create({ name: SHOWCASE_PROJECT_NAME, color: SHOWCASE_PROJECT_COLOR });
  folder = project.id;

  // Papers: one file each, keyed by title for the rows that name them.
  const paperIds = new Map<string, string>();
  let pdfPaperId: string | undefined;
  for (const [i, p] of SHOWCASE_PAPERS.entries()) {
    const id = `showcase-paper-${i + 1}`;
    paperIds.set(p.title, id);
    if (p.arxiv_id === SHOWCASE_PDF_ARXIV_ID) pdfPaperId = id;
    await repos.paperRepository.save({
      id,
      title: p.title,
      authors: p.authors,
      year: p.year,
      status: p.status,
      tags: p.tags,
      summary: p.summary,
      venue: p.venue,
      doi: p.doi,
      arxivId: p.arxiv_id,
      url: p.url,
      abstract: p.abstract,
      rating: p.rating,
      bibtex: p.bibtex,
      metadata: {},
      createdAt: stamp,
      updatedAt: stamp,
    });
  }

  for (const [from, to, relation, note] of SHOWCASE_RELATIONS) {
    const fromPaper = paperIds.get(from);
    const toPaper = paperIds.get(to);
    if (!fromPaper || !toPaper) continue;
    await repos.paperRelationRepository.save({
      id: `showcase-rel-${fromPaper}-${toPaper}`,
      fromPaper,
      toPaper,
      relation,
      note,
      source: "manual",
      createdAt: stamp,
    });
  }

  // Report sections first: pins and experiments name them.
  const sectionIds = new Map<string, string>();
  const sectionIdByTitle = new Map<string, string>();
  for (const s of SHOWCASE_REPORT) {
    const section = await repos.reportSectionRepository.add({
      title: s.title,
      sectionNo: s.section_no,
      parentId: s.parent ? sectionIdByTitle.get(s.parent) : undefined,
      status: s.status,
      wordCount: s.word_count,
      targetWords: s.target_words,
      deadline: s.deadline,
      notes: s.notes,
    });
    sectionIds.set(s.section_no, section.id);
    sectionIdByTitle.set(s.title, section.id);
  }

  for (const [i, [title, annotationKey, sectionNo]] of SHOWCASE_ANNOTATION_PINS.entries()) {
    const paperId = paperIds.get(title);
    const reportSectionId = sectionIds.get(sectionNo);
    if (!paperId || !reportSectionId) continue;
    await repos.annotationPinRepository.save({ paperId, annotationKey, reportSectionId, createdAt: stamp });
    await repos.quotationTypeRepository.save({
      paperId,
      annotationKey,
      quotationType: QUOTATION_TYPES[i % QUOTATION_TYPES.length]!,
    });
  }

  // Paper field: "Reproduced" on the first pinned paper.
  const fieldPaperId = paperIds.get(SHOWCASE_ANNOTATION_PINS[0]?.[0] ?? "");
  if (fieldPaperId) {
    const reproduced = { id: "showcase-field-reproduced", name: "Reproduced", kind: "select" as const, options: ["yes", "partly", "no"], sortOrder: 0 };
    await repos.paperFieldRepository.saveDef(reproduced);
    await repos.paperFieldRepository.setValue({ paperId: fieldPaperId, fieldId: reproduced.id, value: "partly" });
  }

  const listIds = new Map<string, string>();
  for (const [i, l] of SHOWCASE_READING_LISTS.entries()) {
    const id = `showcase-list-${i + 1}`;
    listIds.set(l.name, id);
    await repos.readingListRepository.save({
      id,
      name: l.name,
      description: l.description,
      parentId: l.parent ? listIds.get(l.parent) : undefined,
      sortOrder: i,
      color: l.color,
      createdAt: stamp,
    });
    for (const [j, title] of l.papers.entries()) {
      const paperId = paperIds.get(title);
      if (!paperId) continue;
      await repos.readingListItemRepository.add({
        id: `${id}-item-${j + 1}`,
        listId: id,
        paperId,
        sortOrder: j,
        note: l.notes?.[title],
      });
    }
  }

  for (const e of SHOWCASE_EXPERIMENTS) {
    const experiment = await repos.experimentRepository.add({
      name: e.name,
      hypothesis: e.hypothesis,
      status: e.status,
      config: e.config,
      metrics: e.metrics,
      branch: e.branch,
      commitSha: e.commit_sha,
      repoUrl: e.repo_url,
      runCommand: e.run_command,
      resultNote: e.result_note,
      relatedPaper: e.related_paper ? paperIds.get(e.related_paper) : undefined,
      artifacts: e.artifacts?.map(([, file]) => file),
    });
    await repos.metricRepository.append(metricCurve(experiment.id, e.metrics));
  }

  // Dependencies name other milestones by id, so every milestone is added first
  // and the links are set once the ids exist.
  const milestoneIds = new Map<string, string>();
  for (const m of SHOWCASE_MILESTONES) {
    const milestone = await repos.milestoneRepository.add({
      title: m.title,
      description: m.description,
      status: m.status,
      targetDate: m.target_date,
      compute: m.compute,
    });
    milestoneIds.set(m.title, milestone.id);
  }
  for (const m of SHOWCASE_MILESTONES) {
    if (!m.dependencies?.length) continue;
    const dependencies = m.dependencies.map((d) => {
      if (d.kind === "external") return d;
      const refId = milestoneIds.get(d.label ?? "");
      if (!refId) throw new Error(`Showcase milestone "${m.title}" depends on unknown milestone "${d.label}".`);
      return { ...d, refId };
    });
    await repos.milestoneRepository.update(milestoneIds.get(m.title)!, { dependencies });
  }

  for (const entry of SHOWCASE_LOG) {
    await repos.logEntryRepository.add({
      body: entry.body,
      entryDate: isoDate(now, entry.daysAgo),
      kind: entry.kind,
    });
  }

  // Vault notes and wiki pages. Charts are written as workspace assets.
  await repos.rawVaultPageRepository.save({
    id: "showcase-wiki-root",
    title: SHOWCASE_WIKI_ROOT.title,
    body: SHOWCASE_WIKI_ROOT.body,
    folder: false,
    sortOrder: 0,
    createdAt: stamp,
    updatedAt: stamp,
  });
  const pages: ShowcaseWikiPage[] = [...SHOWCASE_VAULT, ...SHOWCASE_WIKI];
  for (const [i, page] of pages.entries()) {
    const figure = page.figure;
    if (figure) {
      const bytes = await parts.readChart(figure.file);
      if (bytes) await parts.fs.writeFile(`${folder}/assets/${figure.file}`, bytes);
    }
    await repos.rawVaultPageRepository.save({
      id: `showcase-note-${i + 1}`,
      title: page.title,
      body: page.body,
      parentId: "showcase-wiki-root",
      sortOrder: i + 1,
      createdAt: stamp,
      updatedAt: stamp,
    });
  }

  return { projectId: project.id, pdfPaperId };
}
