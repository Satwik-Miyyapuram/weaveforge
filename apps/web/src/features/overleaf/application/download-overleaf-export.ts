import { zipSync, strToU8 } from "fflate";
import type { Paper, ReportSectionTreeNode } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import {
  assertSafeExportPath,
  buildOverleafExportPackage,
  missingFigureWarning,
  withMissingFigures,
  type OverleafExportImage,
  type OverleafExportOptions,
} from "./build-overleaf-export";
import { downloadBlob, zipToBlob } from "@/lib/blob-output";

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
  for (const f of result.files) assertSafeExportPath(f.path);
  for (const img of result.images) assertSafeExportPath(img.zipPath);

  const missing: OverleafExportImage[] = [];
  if (result.images.length > 0) {
    const uniquePaths = [...new Set(result.images.map((i) => i.storagePath))];
    const blobs = await getContainer().report.fetchImageBlobs(uniquePaths);
    for (const img of result.images) {
      const blob = blobs.get(img.storagePath);
      if (!blob) {
        warnings.push(missingFigureWarning(img));
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
