import { getContainer } from "@/bootstrap";
import {
  desktop,
  type DesktopBridge,
  type DesktopOverleafSync,
  type DesktopOverleafSyncRequest,
} from "@/lib/desktop/desktop-bridge";
import { downloadBlob, zipToBlob } from "@/lib/parts";
import { loadCore, readyCore } from "@/lib/rust-core";
import {
  type CitationFormat,
  type Experiment,
  type Paper,
  type ReportSectionTreeNode,
} from "@weaveforge/core";
import { paperCiteKeys } from "@weaveforge/wasm";
import { strToU8, zipSync } from "fflate";

// --- build-overleaf-export ---
export interface OverleafExportOptions {
  /** Document title for `\title{}`. */
  title?: string;
  includeBibliography?: boolean;
  includeSectionNotes?: boolean;
  /**
   * Which papers reach `references.bib`.
   *
   * `"all"` (default) exports the whole library and adds `\nocite{*}` so every
   * entry actually prints. Without the `\nocite`, biblatex's numeric style
   * renders only cited entries, so a 20-paper export would show two — the
   * `.bib` is right and the PDF looks broken.
   *
   * `"cited"` exports only papers cited in the report, which is what a
   * finished thesis bibliography should contain.
   */
  bibliographyScope?: "cited" | "all";
  /** Runs for `exptable:` results tables in section notes; without them a table ref is a warning. */
  experiments?: readonly Experiment[];
}

/** The tree with every `exptable:` ref in its notes turned into a LaTeX table. */
function withResultsTables(
  nodes: readonly ReportSectionTreeNode[],
  experiments: readonly Experiment[],
): ReportSectionTreeNode[] {
  return nodes.map((node) => ({
    ...node,
    section: node.section.notes
      ? { ...node.section, notes: readyCore().resolveResultsTables(node.section.notes, experiments, "latex") }
      : node.section,
    children: withResultsTables(node.children, experiments),
  }));
}

interface OverleafExportFile {
  path: string;
  contents: string;
}

/** Binary figure to fetch from report-images and place under `figures/`. */
export interface OverleafExportImage {
  /** Storage path after `reportimg:` (ownerId/sectionId/file). */
  storagePath: string;
  /** Relative ZIP path, e.g. `figures/uuid.webp`. */
  zipPath: string;
}

export interface OverleafExportResult {
  files: OverleafExportFile[];
  images: OverleafExportImage[];
  warnings: string[];
  stats: {
    sections: number;
    equationsApprox: number;
    bibliographyEntries: number;
    figures: number;
  };
}

export type { CitationFormat };

/**
 * The export's files with `manifest.json` rewritten for figures whose blobs
 * could not be loaded: they leave `files`, are listed under `missingFigures`
 * and get a warning each. With none missing, `files` is returned as is.
 */
export function withMissingFigures(
  files: readonly OverleafExportFile[],
  missing: readonly OverleafExportImage[],
): readonly OverleafExportFile[] {
  if (missing.length === 0) return files;
  return readyCore().withMissingFigures(files, missing);
}

/** Title→cite-key and paper-id→cite-key maps for the export's wikilinks and .bib keys. */
function buildCiteByTitle(
  papers: readonly Paper[],
): { citeByTitle: Map<string, string>; keyByPaperId: Map<string, string> } {
  const keys = paperCiteKeys(papers);
  const citeByTitle = new Map<string, string>();
  const keyByPaperId = new Map<string, string>();
  papers.forEach((p, i) => {
    const key = keys[i] ?? "";
    keyByPaperId.set(p.id, key);
    const titleKey = readyCore().normalizeTitleKey(p.title ?? "");
    if (titleKey && !citeByTitle.has(titleKey)) citeByTitle.set(titleKey, key);
  });
  return { citeByTitle, keyByPaperId };
}

/**
 * Build an Overleaf-ready plaintext package from the WeaveForge report outline
 * and optional paper bibliography. Pure — no I/O, no network.
 * The text files (main.tex preamble, bibliography scope, references.bib,
 * manifest.json, README.txt) are built in Rust (`buildOverleafExportFiles`);
 * this function keeps the section walk and the cite keys, which need the
 * TS-side helpers. Binary figures are listed in `images` for the download step.
 * Section-note `[[Paper Title]]` wikilinks become `\cite{…}` when bibliography is included.
 */
export function buildOverleafExportPackage(
  tree: readonly ReportSectionTreeNode[],
  papers: readonly Paper[],
  opts: OverleafExportOptions = {},
): OverleafExportResult {
  const includeNotes = opts.includeSectionNotes !== false;
  const includeBib = opts.includeBibliography !== false;

  const { citeByTitle, keyByPaperId } = includeBib
    ? buildCiteByTitle(papers)
    : { citeByTitle: new Map<string, string>(), keyByPaperId: new Map<string, string>() };

  const walk = readyCore().walkOverleafSections(
    opts.experiments ? withResultsTables(tree, opts.experiments) : tree,
    {
      includeNotes,
      citeByTitle: includeBib && papers.length > 0 ? citeByTitle : undefined,
    },
  );

  const entries = includeBib
    ? papers.map((paper) => ({ paper, key: keyByPaperId.get(paper.id) ?? "" }))
    : [];
  const built = readyCore().buildOverleafExportFiles(
    {
      body: walk.out,
      walkWarnings: walk.warnings,
      images: walk.images,
      sections: walk.stats.sections,
      equationsApprox: walk.stats.equationsApprox,
      figures: walk.stats.figures,
      title: opts.title,
      includeBibliography: includeBib,
      bibliographyScope: opts.bibliographyScope ?? "all",
      exportedAt: new Date().toISOString(),
    },
    entries,
  );
  return { files: built.files, images: walk.images, warnings: built.warnings, stats: built.stats };
}

// --- download-overleaf-export ---
/** Build the Overleaf package and download it as a ZIP (browser-local). */
export async function downloadOverleafExportPackage(
  tree: readonly ReportSectionTreeNode[],
  papers: readonly Paper[],
  opts: OverleafExportOptions = {},
): Promise<{
  warnings: string[];
  stats: {
    sections: number;
    equationsApprox: number;
    bibliographyEntries: number;
    figures: number;
  };
}> {
  // Results tables are rebuilt from the runs as they are now.
  const experiments =
    opts.experiments ?? (readyCore().hasResultsTables(tree) ? await getContainer().experiments.loadExperiments() : undefined);
  const result = buildOverleafExportPackage(tree, papers, { ...opts, experiments });
  const warnings = [...result.warnings];
  const root = `weaveforge-overleaf-export-${new Date().toISOString().slice(0, 10)}`;
  const files: Record<string, Uint8Array> = {};
  for (const f of result.files) readyCore().assertSafeExportPath(f.path);
  for (const img of result.images) readyCore().assertSafeExportPath(img.zipPath);

  const missing: OverleafExportImage[] = [];
  if (result.images.length > 0) {
    const uniquePaths = [...new Set(result.images.map((i) => i.storagePath))];
    const blobs = await getContainer().report.fetchImageBlobs(uniquePaths);
    for (const img of result.images) {
      const blob = blobs.get(img.storagePath);
      if (!blob) {
        warnings.push(readyCore().missingFigureWarning(img));
        missing.push(img);
        continue;
      }
      files[`${root}/${img.zipPath}`] = new Uint8Array(await blob.arrayBuffer());
    }
  }

  // The manifest lists only what is in the ZIP and names what is not.
  for (const f of withMissingFigures(result.files, missing)) {
    files[`${root}/${f.path}`] = strToU8(f.contents);
  }

  downloadBlob(zipToBlob(zipSync(files, { level: 6 })), `${root}.zip`);
  return { warnings, stats: result.stats };
}

// --- overleaf-folder-sync ---
/**
 * Overleaf projects synced into vault folders over Overleaf's git bridge
 * (Settings → Workspace folder). Desktop only: the shell runs git and holds
 * the token; this module stores what was typed and names the action. Files a
 * pull brings in reach the app the way any outside edit to the folder does.
 */

const NO_SHELL = "Syncing Overleaf projects needs the desktop app.";

type Shell = DesktopBridge & Required<Pick<DesktopBridge, "overleafSync">>;

function shell(): Shell | null {
  const bridge = desktop();
  return bridge && typeof bridge.overleafSync === "function" ? (bridge as Shell) : null;
}

export function overleafSyncAvailable(): boolean {
  return shell() !== null;
}

export function overleafSync(request: DesktopOverleafSyncRequest): Promise<DesktopOverleafSync> {
  const bridge = shell();
  if (!bridge) return Promise.reject(new Error(NO_SHELL));
  return bridge.overleafSync(request);
}

/** Store the Overleaf git token; the shell never hands it back. */
export async function saveOverleafToken(token: string): Promise<void> {
  const bridge = shell();
  if (!bridge) throw new Error(NO_SHELL);
  if (!token.trim()) throw new Error("Paste your Overleaf git token.");
  await bridge.writeSecret("overleaf-token", token.trim());
}

/** One line for the panel. */
export async function describeOverleafSync(reply: DesktopOverleafSync): Promise<string> {
  const core = await loadCore();
  if (reply.pull) return core.describePull(reply.pull);
  if (reply.push) return core.describePush(reply.push);
  return core.describeOverleafStatus(reply.status ?? null);
}
