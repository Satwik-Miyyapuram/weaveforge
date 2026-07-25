import { zipSync, strToU8 } from "fflate";
import { vaultAssetPathsInBody } from "@thesis/core";
import { getContainer } from "@/bootstrap";

function jsonFile(value: unknown): Uint8Array {
  return strToU8(JSON.stringify(value, null, 2));
}

/**
 * Full account export as a ZIP: domain JSON per feature plus vault/paper blobs.
 * Runs client-side; content is plaintext (RLS + at-rest).
 */
export async function exportUserData(): Promise<Blob> {
  const c = getContainer();
  const [vault, papers, lists, report, experiments, plan, logEntries] = await Promise.all([
    c.vault.loadScreenData(),
    c.papers.loadScreenData(),
    c.readingLists.loadScreenData(),
    c.report.loadScreenData(),
    c.experiments.loadScreenData(),
    c.plan.loadScreenData(),
    c.logbook.loadEntries(),
  ]);

  const date = new Date().toISOString().slice(0, 10);
  const root = `weaveforge-export-${date}`;
  const files: Record<string, Uint8Array> = {};

  const manifest = {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    app: "WeaveForge",
    encryption: { exportedDecrypted: true, e2eeEnabled: false },
    stats: {
      notes: vault.flat.length,
      papers: papers.papers.length,
      readingLists: lists.lists.length,
      reportSections: report.flat.length,
      experiments: experiments.experiments.length,
      milestones: plan.milestones.length,
      logEntries: logEntries.length,
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
      "",
      "Content is plaintext JSON + binary assets.",
    ].join("\n"),
  );

  files[`${root}/notes/pages.json`] = jsonFile(vault.flat);
  files[`${root}/papers/index.json`] = jsonFile(papers.papers);
  files[`${root}/reading-lists/tree.json`] = jsonFile(lists.lists);
  files[`${root}/report/sections.json`] = jsonFile(report.flat);
  files[`${root}/experiments/index.json`] = jsonFile(experiments.experiments);
  files[`${root}/plan/milestones.json`] = jsonFile(plan.milestones);
  files[`${root}/logbook/entries.json`] = jsonFile(logEntries);

  // Vault assets referenced in note bodies.
  const vaultPaths = new Set<string>();
  for (const page of vault.flat) {
    for (const path of vaultAssetPathsInBody(page.body)) vaultPaths.add(path);
  }
  if (vaultPaths.size > 0) {
    const blobs = await c.vault.fetchAssetBlobs([...vaultPaths]);
    for (const [path, blob] of blobs) {
      if (!blob) continue;
      const name = path.split("/").pop() ?? path;
      const pageId = path.split("/")[1] ?? "unknown";
      const bytes = new Uint8Array(await blob.arrayBuffer());
      files[`${root}/notes/assets/${pageId}/${name}`] = bytes;
    }
  }

  // Paper images from metadata.images paths.
  const paperImagePaths: string[] = [];
  for (const paper of papers.papers) {
    const images = (paper.metadata as { images?: string[] } | undefined)?.images;
    if (!images) continue;
    for (const path of images) paperImagePaths.push(path);
  }
  if (paperImagePaths.length > 0) {
    const blobs = await c.papers.fetchImageBlobs(paperImagePaths);
    for (const [path, blob] of blobs) {
      if (!blob) continue;
      const name = path.split("/").pop() ?? path;
      const paperId = path.split("/")[1] ?? "unknown";
      const bytes = new Uint8Array(await blob.arrayBuffer());
      files[`${root}/papers/images/${paperId}/${name}`] = bytes;
    }
  }

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

