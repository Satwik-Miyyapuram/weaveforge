/** Loading pdf.js, and reading text and outline out of a document. */
import { isEditableReaderTarget, type PdfLocus } from "@weaveforge/core";
import type { ReaderOutlineItem } from "../reader-outline";
import type { PdfDocument, PdfLib, PageText, TextItemGeometry } from "./types";

/** Per-page resolve must ignore document-scoped position offsets. */
export function pageScopedLocus(locus: PdfLocus): PdfLocus {
  return { quote: locus.quote };
}

/** The pdf.js bundle is a megabyte; it is fetched once, on the first open. */
let pdfLibPromise: Promise<PdfLib> | null = null;

export async function loadPdfLib(): Promise<PdfLib> {
  if (!pdfLibPromise) {
    pdfLibPromise = import("pdfjs-dist").then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return lib;
    });
  }
  return pdfLibPromise;
}

export function buildPageText(items: readonly { str: string; hasEOL?: boolean }[]): PageText {
  let text = "";
  const ranges: PageText["items"] = [];
  items.forEach((item, index) => {
    const start = text.length;
    text += item.str;
    ranges.push({ start, end: text.length, index });
    if (item.hasEOL) text += "\n";
  });
  return { text, items: ranges };
}

export function textItemsFromContent(content: { items: readonly unknown[] }): TextItemGeometry[] {
  return content.items.flatMap((raw): TextItemGeometry[] => {
    const it = raw as Partial<TextItemGeometry>;
    if (typeof it.str !== "string" || !Array.isArray(it.transform)) return [];
    return [
      {
        str: it.str,
        hasEOL: Boolean((raw as { hasEOL?: boolean }).hasEOL),
        transform: it.transform,
        width: typeof it.width === "number" ? it.width : 0,
        height: typeof it.height === "number" ? it.height : 0,
      },
    ];
  });
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return isEditableReaderTarget(target);
}

export async function mapOutline(
  doc: PdfDocument,
  nodes: readonly { title?: string; dest?: unknown; items?: unknown[] }[],
): Promise<ReaderOutlineItem[]> {
  const out: ReaderOutlineItem[] = [];
  for (const node of nodes) {
    let pageNumber: number | null = null;
    try {
      if (node.dest) {
        const dest =
          typeof node.dest === "string" ? await doc.getDestination(node.dest) : node.dest;
        if (Array.isArray(dest) && dest[0]) {
          const idx = await doc.getPageIndex(dest[0] as Parameters<PdfDocument["getPageIndex"]>[0]);
          pageNumber = idx + 1;
        }
      }
    } catch {
      pageNumber = null;
    }
    const children = Array.isArray(node.items)
      ? await mapOutline(doc, node.items as { title?: string; dest?: unknown; items?: unknown[] }[])
      : undefined;
    out.push({
      title: node.title?.trim() || "Untitled",
      pageNumber,
      ...(children?.length ? { items: children } : {}),
    });
  }
  return out;
}
