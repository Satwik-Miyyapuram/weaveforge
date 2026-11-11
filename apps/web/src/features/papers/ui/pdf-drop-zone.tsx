"use client";

import { FileDropZone } from "@/components/file-drop-zone";
import { showToast } from "@/lib/toast/index";
import { formatError } from "@/lib/format-error";
import type { PdfDropOutcome } from "../application/parts-2";
import { splitPaperDrop, type BibImportOutcome } from "../application/parts-2";
import { addBibFile } from "./bib-import";
import { addPdfFiles } from "./pdf-drop";

/** One `.bib` after another, each with its own outcome; one failed file does not stop the rest. */
async function importBibs(files: readonly File[], onBib: (outcome: BibImportOutcome) => void): Promise<void> {
  for (const file of files) {
    try {
      onBib(await addBibFile(file));
    } catch (err) {
      showToast(`${file.name}: ${formatError(err)}`);
    }
  }
}

/**
 * Drop PDFs or `.bib` files anywhere on Papers to add them (design D-21),
 * any number at once.
 */
export function PaperDropZone({
  onPdfs,
  onBib,
}: {
  onPdfs: (outcomes: PdfDropOutcome[]) => void;
  onBib: (outcome: BibImportOutcome) => void;
}) {
  return (
    <FileDropZone
      label="Drop PDFs or .bib files to add papers"
      onFiles={(files) => {
        const { pdfs, bibs } = splitPaperDrop(files);
        if (pdfs.length > 0) {
          showToast(pdfs.length === 1 ? "Adding paper…" : `Adding ${pdfs.length} files…`);
          addPdfFiles(pdfs).then(onPdfs, (err) => showToast(formatError(err)));
        }
        void importBibs(bibs, onBib);
      }}
    />
  );
}
