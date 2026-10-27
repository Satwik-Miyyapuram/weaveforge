/**
 * A PDF on disk could not become a paper: the add form took a title or a
 * reference, never a file (design D-21, D23). Dropping a PDF on Papers, or
 * picking one in Add paper, reads the DOI off the first page, falls back to a
 * title lookup, and as a last resort names the paper after the file and says
 * so. The file is kept as the paper's PDF.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MetadataResolutionError, type Paper, type PaperRef } from "@weaveforge/core";
import {
  MAX_PDF_BYTES,
  addPaperFromPdf,
  guessTitle,
  isPdfFile,
  summarizePdfDrop,
  type PdfDropDeps,
  type PdfDropOutcome,
} from "../application/paper-from-pdf";

const paper = (id: string, title = id) => ({ id, title }) as Paper;
const bytes = new ArrayBuffer(8);

function deps(over: Partial<PdfDropDeps> = {}) {
  const calls = { refs: [] as PaperRef[], titles: [] as string[], kept: [] as string[], created: [] as string[] };
  const d: PdfDropDeps = {
    online: () => true,
    readFirstPage: async () => "",
    importRef: async (ref) => {
      calls.refs.push(ref);
      throw new MetadataResolutionError("no match");
    },
    addByTitle: async (title) => {
      calls.titles.push(title);
      return { paper: paper("p-file", title), created: true };
    },
    keepPdf: async (id) => {
      calls.kept.push(id);
    },
    afterCreate: async (p) => {
      calls.created.push(p.id);
    },
    ...over,
  };
  return { d, calls };
}

const file = (name: string, size = 8, type = "application/pdf") => ({
  name,
  size,
  type,
  arrayBuffer: async () => bytes,
});

test("the DOI on the first page finds the paper", async () => {
  const { d, calls } = deps({
    readFirstPage: async () => "Attention Is All You Need\nhttps://doi.org/10.48550/arXiv.1706.03762.\nAbstract",
    importRef: async (ref) => {
      calls.refs.push(ref);
      return { paper: paper("p-doi"), created: true };
    },
  });
  const out = await addPaperFromPdf(file("attn.pdf"), d);
  assert.deepEqual(calls.refs, [{ kind: "doi", value: "10.48550/arxiv.1706.03762" }]);
  assert.equal(out.kind, "added");
  assert.ok(out.kind === "added" && out.matched && out.created);
  assert.deepEqual(calls.kept, ["p-doi"], "the dropped file becomes the paper's PDF");
  assert.deepEqual(calls.created, ["p-doi"], "a new paper gets its note and Zotero push");
});

test("no DOI falls back to a title lookup", async () => {
  const { d, calls } = deps({
    readFirstPage: async () => "arXiv:1706.03762v5 [cs.CL]\nAttention Is All You Need\nAshish Vaswani",
    importRef: async (ref) => {
      calls.refs.push(ref);
      return { paper: paper("p-title"), created: true };
    },
  });
  const out = await addPaperFromPdf(file("x.pdf"), d);
  assert.deepEqual(calls.refs, [
    { kind: "bibliographic", value: "Attention Is All You Need", hints: { title: "Attention Is All You Need" } },
  ]);
  assert.ok(out.kind === "added" && out.matched);
});

test("a DOI that resolves nowhere still tries the title", async () => {
  const { d, calls } = deps({ readFirstPage: async () => "A Long Enough Paper Title Here\ndoi:10.1234/abcd" });
  await addPaperFromPdf(file("x.pdf"), d);
  assert.deepEqual(calls.refs.map((r) => r.kind), ["doi", "bibliographic"]);
});

test("no DOI and no match names the paper after the file, and says so", async () => {
  // A scanned PDF has no text layer at all.
  const { d, calls } = deps({ readFirstPage: async () => "" });
  const out = await addPaperFromPdf(file("Smith 2021 - survey.PDF"), d);
  assert.deepEqual(calls.refs, [], "nothing to look up");
  assert.deepEqual(calls.titles, ["Smith 2021 - survey"]);
  assert.ok(out.kind === "added" && !out.matched);
  assert.deepEqual(calls.kept, ["p-file"]);
  assert.match(summarizePdfDrop([out]).message, /titled from the file name/);
});

test("a PDF pdf.js cannot read is still kept under its file name", async () => {
  const { d, calls } = deps({
    readFirstPage: async () => {
      throw new Error("Invalid PDF structure");
    },
  });
  const out = await addPaperFromPdf(file("broken.pdf"), d);
  assert.deepEqual(calls.titles, ["broken"]);
  assert.ok(out.kind === "added" && !out.matched);
});

test("offline keeps the file under its name, to look up later", async () => {
  const { d, calls } = deps({ online: () => false, readFirstPage: async () => "doi:10.1234/abcd" });
  const out = await addPaperFromPdf(file("later.pdf"), d);
  assert.deepEqual(calls.refs, [], "no lookup while offline");
  assert.deepEqual(calls.titles, ["later"]);
  assert.deepEqual(calls.kept, ["p-file"]);
  assert.ok(out.kind === "added" && out.offline);
  assert.match(summarizePdfDrop([out]).message, /offline/i);
});

test("a duplicate DOI opens the existing paper and leaves its PDF alone", async () => {
  const { d, calls } = deps({
    readFirstPage: async () => "doi:10.1234/abcd",
    importRef: async () => ({ paper: paper("p-old"), created: false }),
  });
  const out = await addPaperFromPdf(file("dup.pdf"), d);
  assert.ok(out.kind === "added" && !out.created);
  assert.deepEqual(calls.kept, []);
  assert.deepEqual(calls.created, []);
  const s = summarizePdfDrop([out]);
  assert.equal(s.message, "Already in library");
  assert.equal(s.open?.id, "p-old");
});

test("a lookup error that is not 'no match' is reported, not hidden", async () => {
  const { d } = deps({
    readFirstPage: async () => "doi:10.1234/abcd",
    importRef: async () => {
      throw new Error("library is read-only");
    },
  });
  await assert.rejects(addPaperFromPdf(file("x.pdf"), d), /read-only/);
});

test("non-PDFs and huge files are skipped before any work", async () => {
  const { d, calls } = deps();
  assert.equal(isPdfFile(file("notes.txt", 8, "text/plain")), false);
  assert.equal(isPdfFile(file("paper.pdf", 8, "")), true, "the extension is enough");
  const notPdf = await addPaperFromPdf(file("notes.txt", 8, "text/plain"), d);
  const huge = await addPaperFromPdf(file("big.pdf", MAX_PDF_BYTES + 1), d);
  assert.deepEqual([notPdf, huge], [
    { kind: "skipped", file: "notes.txt", reason: "not a PDF" },
    { kind: "skipped", file: "big.pdf", reason: "too large" },
  ]);
  assert.deepEqual(calls.titles, []);
});

test("several PDFs give one toast with the count", () => {
  const added = (id: string, created = true, matched = true): PdfDropOutcome => ({
    kind: "added",
    file: `${id}.pdf`,
    paper: paper(id),
    created,
    matched,
    offline: false,
  });
  const s = summarizePdfDrop([
    added("a"),
    added("b"),
    added("c", true, false),
    added("d", false),
    { kind: "skipped", file: "x.txt", reason: "not a PDF" },
  ]);
  assert.equal(s.message, "3 papers added · 1 already in library · 1 titled from the file name · 1 skipped");
  assert.equal(s.open, undefined, "no single paper to open");
  assert.equal(summarizePdfDrop([added("a")]).message, "Paper added");
  assert.equal(summarizePdfDrop([added("a")]).open?.id, "a");
});

test("the title guess skips header noise", () => {
  assert.equal(guessTitle("Preprint. Under review.\nDeep Residual Learning for Image Recognition\nKaiming He"),
    "Deep Residual Learning for Image Recognition");
  assert.equal(guessTitle("short\n12 34\n"), undefined);
});

test("Papers shows a drop zone only while a file is dragged over it", () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../ui/${rel}`, import.meta.url)), "utf8");
  const screen = read("papers-list.tsx");
  assert.match(screen, /<PdfDropZone onDropped=\{onPdfsAdded\} \/>/);
  const zone = read("pdf-drop-zone.tsx");
  assert.match(zone, /\{over && \(\s*<div className="pdf-drop-overlay"/);
  assert.match(zone, /dataTransfer\?\.types\.includes\("Files"\)/);
  // The add form offers the same thing as a file picker.
  const form = read("add-paper-form.tsx");
  assert.match(form, /<input\s+id="pdfFile"\s+type="file"\s+accept="application\/pdf,\.pdf"/);
});
