/**
 * The container, pdf.js and the PDF byte cache behind {@link addPaperFromPdf}.
 */

import type { Paper } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { getReaderPdfByteCache } from "@/features/reader/application/resolve-paper-pdf-for-reader";
import { pdfPageText } from "@/features/search/application/index-library-pdfs";
import { scaffoldNewPaperNote } from "../application/paper-source-note-scaffold";
import { addPaperFromPdf, type PdfDropDeps, type PdfDropOutcome, type PdfFileLike, type PdfText } from "../application/paper-from-pdf";

async function readPdf(bytes: ArrayBuffer): Promise<PdfText> {
  const lib = await import("pdfjs-dist");
  lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  // pdf.js takes ownership of the buffer it is handed; the copy keeps ours for the cache.
  const doc = await lib.getDocument({ data: bytes.slice(0) }).promise;
  try {
    const page = await doc.getPage(1);
    const text = pdfPageText((await page.getTextContent()).items);
    const info = (await doc.getMetadata().catch(() => null))?.info as { Title?: unknown } | undefined;
    return { text, title: typeof info?.Title === "string" ? info.Title : undefined };
  } finally {
    await doc.destroy();
  }
}

const NO_CACHE = "This browser cannot keep a PDF — open a workspace folder first.";

function deps(): PdfDropDeps {
  const papers = getContainer().papers;
  return {
    online: () => typeof navigator === "undefined" || navigator.onLine,
    readPdf,
    importRef: (ref) => papers.importPaper.importRef(ref),
    addByTitle: (title, doi) => papers.addPaper.add(doi ? { title, doi } : { title }),
    hasPdf: async (paperId) => (await getReaderPdfByteCache()?.has(paperId)) ?? false,
    keepPdf: async (paperId, bytes) => {
      const cache = getReaderPdfByteCache();
      if (!cache) throw new Error(NO_CACHE);
      await cache.set(paperId, bytes);
    },
    afterCreate: async (paper: Paper) => {
      const saved = await scaffoldNewPaperNote(paper, papers.updatePaper);
      await getContainer().zotero.autoPush(saved);
    },
  };
}

/** One file after another: each lookup hits the same providers, and order keeps the toast honest. */
export async function addPdfFiles(files: readonly PdfFileLike[]): Promise<PdfDropOutcome[]> {
  // Asked before any paper is made, so none is left without the file it came from.
  if (!getReaderPdfByteCache()) throw new Error(NO_CACHE);
  const d = deps();
  const out: PdfDropOutcome[] = [];
  for (const file of files) out.push(await addPaperFromPdf(file, d));
  return out;
}
