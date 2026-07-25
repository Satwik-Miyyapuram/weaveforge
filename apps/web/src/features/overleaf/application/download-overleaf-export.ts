import { zipSync, strToU8 } from "fflate";
import type { Paper, ReportSectionTreeNode } from "@thesis/core";
import { getContainer } from "@/bootstrap";
import { buildOverleafExportPackage, type OverleafExportOptions } from "./build-overleaf-export";
import { downloadBlob } from "@/features/export/application/export-user-data";

async function blobToU8(blob: Blob): Promise<Uint8Array> {
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

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
  const result = buildOverleafExportPackage(tree, papers, opts);
  const warnings = [...result.warnings];
  const root = `weaveforge-overleaf-export-${new Date().toISOString().slice(0, 10)}`;
  const files: Record<string, Uint8Array> = {};

  for (const f of result.files) {
    // Path traversal guard: only allow simple relative names.
    if (f.path.includes("..") || f.path.startsWith("/") || f.path.includes("\\")) {
      throw new Error(`Refusing unsafe export path: ${f.path}`);
    }
    files[`${root}/${f.path}`] = strToU8(f.contents);
  }

  if (result.images.length > 0) {
    const report = getContainer().report;
    const uniquePaths = [...new Set(result.images.map((i) => i.storagePath))];
    const blobs = await report.fetchImageBlobs(uniquePaths);
    for (const img of result.images) {
      if (img.zipPath.includes("..") || img.zipPath.startsWith("/") || img.zipPath.includes("\\")) {
        throw new Error(`Refusing unsafe export path: ${img.zipPath}`);
      }
      const blob = blobs.get(img.storagePath);
      if (!blob) {
        warnings.push(`Missing figure: ${img.zipPath} (could not load ${img.storagePath})`);
        continue;
      }
      files[`${root}/${img.zipPath}`] = await blobToU8(blob);
    }
  }

  const zipped = zipSync(files, { level: 6 });
  const copy = new Uint8Array(zipped.byteLength);
  copy.set(zipped);
  downloadBlob(new Blob([copy.buffer], { type: "application/zip" }), `${root}.zip`);
  return { warnings, stats: result.stats };
}
