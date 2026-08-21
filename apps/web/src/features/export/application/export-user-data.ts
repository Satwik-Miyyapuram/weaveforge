import { zipSync, strToU8 } from "fflate";
import {
  serializeWorkspace,
  vaultAssetPathsInBody,
  workspaceSnapshotCounts,
  type WorkspaceSnapshot,
} from "@weaveforge/core";
import { getContainer } from "@/bootstrap";

function jsonFile(value: unknown): Uint8Array {
  return strToU8(JSON.stringify(value, null, 2));
}

/** Blob readers the export needs; the facades satisfy this shape directly. */
export interface ExportAssetReaders {
  fetchVaultAssets(paths: readonly string[]): Promise<Map<string, Blob | null>>;
  fetchPaperImages(paths: readonly string[]): Promise<Map<string, Blob | null>>;
}

/**
 * Build the export's file map from a snapshot. Split out from `exportUserData`
 * so it can be tested without a container, and so a future folder writer can
 * use the same map with a different sink instead of a ZIP.
 */
export async function buildExportFiles(
  snapshot: WorkspaceSnapshot,
  assets: ExportAssetReaders,
): Promise<Record<string, Uint8Array>> {
  const counts = workspaceSnapshotCounts(snapshot);

  const date = new Date().toISOString().slice(0, 10);
  const root = `weaveforge-export-${date}`;
  const files: Record<string, Uint8Array> = {};

  const manifest = {
    schemaVersion: 3,
    exportedAt: snapshot.collectedAt,
    app: "WeaveForge",
    encryption: { exportedDecrypted: true, e2eeEnabled: false },
    stats: {
      notes: counts.notes,
      papers: counts.papers,
      readingLists: counts.readingLists,
      reportSections: counts.reportSections,
      experiments: counts.experiments,
      milestones: counts.milestones,
      logEntries: counts.logEntries,
      relations: counts.relations,
      tags: counts.tags,
    },
  };

  files[`${root}/manifest.json`] = jsonFile(manifest);
  files[`${root}/README.txt`] = strToU8(
    [
      "WeaveForge data export",
      `Exported at: ${manifest.exportedAt}`,
      "",
      "Layout:",
      "  manifest.json     — schema + counts",
      "  notes/pages.json  — vault notes",
      "  notes/assets/     — embedded note images",
      "  papers/index.json — papers",
      "  papers/images/    — paper image attachments",
      "  reading-lists/, report/, experiments/, plan/, logbook/",
      "  relations.json, tags.json",
      "",
      "Content is plaintext JSON + binary assets.",
    ].join("\n"),
  );

  files[`${root}/notes/pages.json`] = jsonFile(snapshot.vaultPages);
  files[`${root}/papers/index.json`] = jsonFile(snapshot.papers);
  files[`${root}/reading-lists/tree.json`] = jsonFile(snapshot.readingLists);
  files[`${root}/reading-lists/items.json`] = jsonFile(snapshot.readingListItems);
  files[`${root}/report/sections.json`] = jsonFile(snapshot.reportSections);
  files[`${root}/experiments/index.json`] = jsonFile(snapshot.experiments);
  files[`${root}/plan/milestones.json`] = jsonFile(snapshot.milestones);
  files[`${root}/logbook/entries.json`] = jsonFile(snapshot.logEntries);
  files[`${root}/relations.json`] = jsonFile(snapshot.relations);
  files[`${root}/tags.json`] = jsonFile(snapshot.tags);

  // Vault assets referenced in note bodies.
  const vaultPaths = new Set<string>();
  for (const page of snapshot.vaultPages) {
    for (const path of vaultAssetPathsInBody(page.body)) vaultPaths.add(path);
  }
  if (vaultPaths.size > 0) {
    const blobs = await assets.fetchVaultAssets([...vaultPaths]);
    for (const [path, blob] of blobs) {
      if (!blob) continue;
      const name = path.split("/").pop() ?? path;
      const pageId = path.split("/")[1] ?? "unknown";
      const bytes = new Uint8Array(await blob.arrayBuffer());
      files[`${root}/notes/assets/${pageId}/${name}`] = bytes;
    }
  }

  // Paper images from metadata.images paths. `metadata` is one of the columns
  // the card projection omits, so this loop found nothing before the snapshot.
  const paperImagePaths: string[] = [];
  for (const paper of snapshot.papers) {
    const images = (paper.metadata as { images?: string[] } | undefined)?.images;
    if (!images) continue;
    for (const path of images) paperImagePaths.push(path);
  }
  if (paperImagePaths.length > 0) {
    const blobs = await assets.fetchPaperImages(paperImagePaths);
    for (const [path, blob] of blobs) {
      if (!blob) continue;
      const name = path.split("/").pop() ?? path;
      const paperId = path.split("/")[1] ?? "unknown";
      const bytes = new Uint8Array(await blob.arrayBuffer());
      files[`${root}/papers/images/${paperId}/${name}`] = bytes;
    }
  }

  return files;
}

/**
 * Markdown folder export: the same file map a folder mirror would write, zipped.
 * Opens directly in Obsidian or VS Code — every file carries its `weaveforge-id`
 * in frontmatter, so a re-import matches entities back up regardless of renames.
 */
async function buildWorkspaceFolderFiles(
  snapshot: WorkspaceSnapshot,
  assets: ExportAssetReaders,
): Promise<Record<string, Uint8Array>> {
  const { files, assets: refs } = serializeWorkspace(snapshot);
  const out: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) out[path] = strToU8(content);

  // Blob refs were rewritten to folder-relative paths by the serializer; fetch
  // each one once and write it where the markdown now points.
  const byScope = { notes: [] as string[], papers: [] as string[], report: [] as string[] };
  for (const ref of refs) {
    const scope = ref.folderPath.split("/")[1] as keyof typeof byScope;
    if (byScope[scope]) byScope[scope].push(ref.storagePath);
  }

  const fetched = new Map<string, Blob | null>();
  if (byScope.notes.length) {
    for (const [path, blob] of await assets.fetchVaultAssets(byScope.notes)) fetched.set(path, blob);
  }
  if (byScope.papers.length) {
    for (const [path, blob] of await assets.fetchPaperImages(byScope.papers)) fetched.set(path, blob);
  }

  for (const ref of refs) {
    const blob = fetched.get(ref.storagePath);
    if (!blob) continue;
    out[ref.folderPath] = new Uint8Array(await blob.arrayBuffer());
  }

  return out;
}

/** Download the workspace as a markdown folder. */
export async function downloadWorkspaceFolder(): Promise<void> {
  const c = getContainer();
  const snapshot = await c.workspace.snapshot();
  const files = await buildWorkspaceFolderFiles(snapshot, {
    fetchVaultAssets: (paths) => c.vault.fetchAssetBlobs(paths),
    fetchPaperImages: (paths) => c.papers.fetchImageBlobs(paths),
  });
  const date = new Date().toISOString().slice(0, 10);
  const root = `weaveforge-${date}`;
  const zipped = zipSync(
    Object.fromEntries(Object.entries(files).map(([path, bytes]) => [`${root}/${path}`, bytes])),
    { level: 6 },
  );
  const copy = new Uint8Array(zipped.byteLength);
  copy.set(zipped);
  downloadBlob(new Blob([copy.buffer], { type: "application/zip" }), `${root}.zip`);
}

/**
 * Full account export as a ZIP: domain JSON per feature plus vault/paper blobs.
 * Runs client-side; content is plaintext (RLS + at-rest).
 */
async function exportUserData(): Promise<Blob> {
  const c = getContainer();
  // Read through the workspace snapshot, never the screen facades: those return
  // card projections with `body: ""` on notes and no abstract/bibtex/metadata on
  // papers, which silently emptied this export and dropped every attachment.
  const snapshot = await c.workspace.snapshot();
  const files = await buildExportFiles(snapshot, {
    fetchVaultAssets: (paths) => c.vault.fetchAssetBlobs(paths),
    fetchPaperImages: (paths) => c.papers.fetchImageBlobs(paths),
  });

  const zipped = zipSync(files, { level: 6 });
  // Copy into a fresh ArrayBuffer-backed view so BlobPart typing is happy.
  const copy = new Uint8Array(zipped.byteLength);
  copy.set(zipped);
  return new Blob([copy.buffer], { type: "application/zip" });
}

/** Triggers a browser download of a blob under the given filename. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Convenience: build + download the export as `weaveforge-export-{date}.zip`. */
export async function downloadUserDataExport(): Promise<void> {
  const blob = await exportUserData();
  const date = new Date().toISOString().slice(0, 10);
  downloadBlob(blob, `weaveforge-export-${date}.zip`);
}

