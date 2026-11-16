import { before, test } from "node:test";
import assert from "node:assert/strict";

import { loadTestCore } from "@/lib/test/load-test-core";
import { readyCore, typedCore } from "@/lib/rust-core";
import { decodeInkChunk } from "@weaveforge/core";
import type { OneNoteSection } from "@weaveforge/wasm";
import { importOneNoteSection, type OneNoteImportDeps } from "../application/onenote-import";

before(async () => {
  await loadTestCore();
});

const PNG_BASE64 = Buffer.from([137, 80, 78, 71]).toString("base64");

/** One ink sheet: a blank page, with a printout behind it when `background` is set. */
function sheet(text: string, background?: string) {
  return {
    page: typedCore().blankInkPage("blank"),
    background: background ? { name: background, x: 10, y: 20, width: 100, height: 200 } : null,
    text,
  };
}

/**
 * A section with a page that has an image, a child page with ink on two
 * printout pages, and a sibling page.
 */
function fakeSection(
  inkSheets = [sheet("typed ![pic](image-2.png)", "image-3.png"), sheet("", "image-4.png")],
): OneNoteSection {
  const image = (name: string) => ({ name, alt: "pic", base64: PNG_BASE64 });
  return {
    name: "Lab",
    warnings: ["Page 9 skipped"],
    pages: [
      { title: "A", level: 0, markdown: "x ![pic](image-1.png) y", images: [image("image-1.png")], ink: [] },
      {
        title: "B",
        level: 1,
        markdown: "",
        images: [image("image-2.png"), image("image-3.png"), image("image-4.png")],
        ink: inkSheets,
      },
      { title: "C", level: 0, markdown: "c", images: [], ink: [] },
    ],
  } as unknown as OneNoteSection;
}

/** Deps that record every call; `failUpload` makes uploadAsset reject. */
function fakeDeps(opts: { failUpload?: boolean; section?: OneNoteSection } = {}) {
  let next = 0;
  const adds: { title: string; body?: string; parentId?: string; folder?: boolean; kind?: "canvas"; id: string }[] = [];
  const updates: { id: string; body: string }[] = [];
  const uploads: { pageId: string; ext: string; path: string }[] = [];
  const composed: { box: { x: number; y: number; width: number; height: number }; width: number; height: number }[] =
    [];
  const chunks: { noteId: string; chunkId: string; bytes: Uint8Array }[] = [];
  const deps: OneNoteImportDeps = {
    parse: () => opts.section ?? fakeSection(),
    async pageTitles() {
      return ["Taken"];
    },
    async add(input) {
      const id = `id-${next++}`;
      adds.push({ ...input, id });
      return { id };
    },
    async update(id, body) {
      updates.push({ id, body });
    },
    async uploadAsset(pageId, _blob, ext) {
      if (opts.failUpload) throw new Error("network down");
      const path = `user/p/upload-${uploads.length}.${ext}`;
      uploads.push({ pageId, ext, path });
      return path;
    },
    async composeBackground(blob, box, width, height) {
      composed.push({ box, width, height });
      return { blob, ext: "webp" };
    },
    async writeChunk(noteId, chunkId, bytes) {
      chunks.push({ noteId, chunkId, bytes });
    },
  };
  return { deps, adds, updates, uploads, composed, chunks };
}

function sectionFile(): File {
  return new File([new Uint8Array([1, 2, 3])], "Lab.one");
}

/** The note body last written for `id`, else the one it was added with. */
function finalBody(fake: ReturnType<typeof fakeDeps>, id: string): string {
  const updated = fake.updates.filter((u) => u.id === id).at(-1);
  return updated?.body ?? fake.adds.find((a) => a.id === id)!.body ?? "";
}

test("a OneNote section imports as nested pages with no section note (OneNote)", async () => {
  const fake = fakeDeps();
  const out = await importOneNoteSection(sectionFile(), fake.deps);

  assert.deepEqual(
    fake.adds.map((a) => a.title),
    ["A", "B", "C"],
  );
  assert.ok(fake.adds.every((a) => !a.folder));
  const byTitle = new Map(fake.adds.map((a) => [a.title, a]));
  assert.equal(byTitle.get("A")!.parentId, undefined);
  assert.equal(byTitle.get("B")!.parentId, byTitle.get("A")!.id);
  assert.equal(byTitle.get("C")!.parentId, undefined);

  assert.equal(out.created, 3);
  assert.equal(out.inkNotes, 1);
  assert.deepEqual(out.warnings, ["Page 9 skipped"]);
});

test("a page with ink becomes one ink note, one chunk per printout page (OneNote)", async () => {
  const fake = fakeDeps();
  await importOneNoteSection(sectionFile(), fake.deps);

  const ink = fake.adds.find((a) => a.title === "B")!;
  assert.equal(fake.chunks.length, 2);
  assert.ok(fake.chunks.every((c) => c.noteId === ink.id));

  const body = finalBody(fake, ink.id);
  const note = readyCore().readInkNoteBody(body);
  assert.deepEqual(
    note.meta.pageOrder,
    fake.chunks.map((c) => c.chunkId),
  );
  const texts = typedCore().splitInkTextLayer(note.text);
  assert.equal(texts.length, 2);
  // Typed text keeps its image, uploaded under the ink note; no recognised text is added.
  assert.ok(texts[0]!.includes("typed"));
  const typed = fake.uploads.find((u) => u.pageId === ink.id && u.ext === "png")!;
  assert.ok(texts[0]!.includes(`${readyCore().vaultImagePrefix()}${typed.path}`));
  assert.ok(!body.includes("](image-2.png)"));
});

test("each printout is composed onto its page and set as the page background (OneNote)", async () => {
  const fake = fakeDeps();
  const out = await importOneNoteSection(sectionFile(), fake.deps);

  const page = typedCore().blankInkPage("blank");
  assert.equal(fake.composed.length, 2);
  assert.deepEqual(fake.composed[0], {
    box: { x: 10, y: 20, width: 100, height: 200 },
    width: page.width,
    height: page.height,
  });
  const ink = fake.adds.find((a) => a.title === "B")!;
  const backgrounds = fake.uploads.filter((u) => u.ext === "webp");
  assert.equal(backgrounds.length, 2);
  assert.ok(backgrounds.every((u) => u.pageId === ink.id));

  const body = finalBody(fake, ink.id);
  for (const [i, chunk] of fake.chunks.entries()) {
    const decoded = await decodeInkChunk(chunk.bytes);
    assert.equal(decoded.background, typedCore().inkAttachmentIndex(body, backgrounds[i]!.path));
    assert.ok(decoded.background > 0);
  }
  // Page A's image, the typed image on B and B's two printouts.
  assert.equal(out.images, 4);
});

test("a page past the sheet limit splits into numbered parts (OneNote)", async () => {
  const many = Array.from({ length: 51 }, () => sheet(""));
  const fake = fakeDeps({ section: fakeSection(many) });
  const out = await importOneNoteSection(sectionFile(), fake.deps);

  const parts = fake.adds.filter((a) => a.title.startsWith("B"));
  assert.deepEqual(
    parts.map((a) => a.title),
    ["B", "B (part 2)"],
  );
  assert.equal(parts[1]!.parentId, parts[0]!.parentId);
  assert.equal(fake.chunks.filter((c) => c.noteId === parts[0]!.id).length, 50);
  assert.equal(fake.chunks.filter((c) => c.noteId === parts[1]!.id).length, 1);
  assert.equal(out.inkNotes, 2);
});

test("an image is uploaded under its page and the body points at the vault image (OneNote)", async () => {
  const fake = fakeDeps();
  await importOneNoteSection(sectionFile(), fake.deps);

  const pageA = fake.adds.find((a) => a.title === "A")!;
  const upload = fake.uploads.find((u) => u.pageId === pageA.id)!;
  assert.equal(upload.ext, "png");
  const body = finalBody(fake, pageA.id);
  assert.ok(body.includes(`${readyCore().vaultImagePrefix()}${upload.path}`));
  assert.ok(!body.includes("](image-1.png)"));
});

test("a failed upload warns, drops the image and still resolves (OneNote)", async () => {
  const fake = fakeDeps({ failUpload: true });
  const out = await importOneNoteSection(sectionFile(), fake.deps);

  assert.ok(out.warnings.includes('Image image-1.png on "A" not imported'));
  assert.ok(out.warnings.includes('Page 1 background on "B" not imported'));
  const pageA = fake.adds.find((a) => a.title === "A")!;
  assert.ok(!finalBody(fake, pageA.id).includes("image-1.png"));
  assert.equal(out.images, 0);
  // The ink still lands, on pages without a printout.
  assert.equal(fake.chunks.length, 2);
  for (const chunk of fake.chunks) assert.equal((await decodeInkChunk(chunk.bytes)).background, 0);
});

const CANVAS = { canvas: true };

/**
 * Page A: positioned text and a placed image. Page B: one ink sheet whose
 * printout is its background, so the layout holds only the ink part.
 */
function canvasSection(): OneNoteSection {
  const image = (name: string) => ({ name, alt: "pic", base64: PNG_BASE64 });
  return {
    name: "Lab",
    warnings: [],
    pages: [
      {
        title: "A",
        level: 0,
        markdown: "hello",
        images: [image("image-1.png")],
        ink: [],
        layout: [
          { kind: "text", key: "", text: "hello", x: 0, y: 0, width: 96, height: 48 },
          { kind: "image", key: "image-1.png", text: "", x: 100, y: 100, width: 96, height: 96 },
        ],
      },
      {
        title: "B",
        level: 0,
        markdown: "",
        images: [image("image-2.png")],
        ink: [sheet("typed", "image-2.png")],
        layout: [{ kind: "ink", key: "ink-0", text: "", x: 0, y: 0, width: 378, height: 504 }],
      },
    ],
  } as unknown as OneNoteSection;
}

test("canvas mode makes each page a canvas, with its ink notes under it (OneNote)", async () => {
  const fake = fakeDeps({ section: canvasSection() });
  await importOneNoteSection(sectionFile(), fake.deps, CANVAS);

  const a = fake.adds.find((x) => x.title === "A")!;
  const b = fake.adds.find((x) => x.title === "B")!;
  const ink = fake.adds.find((x) => x.title === "B (handwriting)")!;
  assert.equal(a.kind, "canvas");
  assert.equal(b.kind, "canvas");
  assert.equal(ink.kind, undefined);
  assert.equal(ink.parentId, b.id);
  assert.equal(fake.adds.length, 3);
});

test("canvas mode writes a JSON Canvas whose file nodes point at uploads and ink notes (OneNote)", async () => {
  const fake = fakeDeps({ section: canvasSection() });
  await importOneNoteSection(sectionFile(), fake.deps, CANVAS);

  const a = fake.adds.find((x) => x.title === "A")!;
  const b = fake.adds.find((x) => x.title === "B")!;
  const upload = fake.uploads.find((u) => u.pageId === a.id)!;

  const pageA = JSON.parse(finalBody(fake, a.id)) as { nodes: { type: string; text?: string; file?: string }[] };
  assert.deepEqual(
    pageA.nodes.map((n) => n.type),
    ["text", "text"],
  );
  assert.equal(pageA.nodes[0]!.text, "hello");
  // A picture is a text node holding its vault image, not a file node.
  assert.ok(pageA.nodes[1]!.text!.includes(`](vault:${upload.path})`));

  const pageB = JSON.parse(finalBody(fake, b.id)) as { nodes: { type: string; file?: string }[] };
  assert.deepEqual(
    pageB.nodes.map((n) => n.file),
    ["notes/B (handwriting).note.md"],
  );
});

test("canvas mode uploads only the images placed on the canvas (OneNote)", async () => {
  const fake = fakeDeps({ section: canvasSection() });
  await importOneNoteSection(sectionFile(), fake.deps, CANVAS);

  const a = fake.adds.find((x) => x.title === "A")!;
  const b = fake.adds.find((x) => x.title === "B")!;
  assert.equal(fake.uploads.filter((u) => u.pageId === a.id).length, 1);
  // B's printout is the ink note's background, uploaded to the ink note, never to the canvas.
  assert.equal(fake.uploads.filter((u) => u.pageId === b.id).length, 0);
});

test("canvas mode drops an image whose upload failed and keeps the ink part (OneNote)", async () => {
  const fake = fakeDeps({ section: canvasSection(), failUpload: true });
  const out = await importOneNoteSection(sectionFile(), fake.deps, CANVAS);

  assert.ok(out.warnings.includes('Image image-1.png on "A" not imported'));
  const a = fake.adds.find((x) => x.title === "A")!;
  const b = fake.adds.find((x) => x.title === "B")!;
  const pageA = JSON.parse(finalBody(fake, a.id)) as { nodes: { type: string }[] };
  assert.deepEqual(
    pageA.nodes.map((n) => n.type),
    ["text"],
  );
  const pageB = JSON.parse(finalBody(fake, b.id)) as { nodes: { file?: string }[] };
  assert.deepEqual(
    pageB.nodes.map((n) => n.file),
    ["notes/B (handwriting).note.md"],
  );
});

test("canvas mode keeps typed ink text out of the ink note, so nothing is written twice (OneNote)", async () => {
  const image = (name: string) => ({ name, alt: "pic", base64: PNG_BASE64 });
  const section = {
    name: "Lab",
    warnings: [],
    pages: [
      {
        title: "B",
        level: 0,
        markdown: "",
        images: [image("image-1.png"), image("image-2.png")],
        ink: [sheet("typed ![pic](image-1.png)", "image-2.png")],
        layout: [
          { kind: "text", key: "", text: "typed", x: 0, y: 0, width: 96, height: 48 },
          { kind: "image", key: "image-1.png", text: "", x: 100, y: 100, width: 96, height: 96 },
          { kind: "ink", key: "ink-0", text: "", x: 0, y: 0, width: 378, height: 504 },
        ],
      },
    ],
  } as unknown as OneNoteSection;
  const fake = fakeDeps({ section });
  await importOneNoteSection(sectionFile(), fake.deps, CANVAS);

  const b = fake.adds.find((x) => x.title === "B")!;
  const ink = fake.adds.find((x) => x.title === "B (handwriting)")!;
  const inkBody = finalBody(fake, ink.id);
  assert.ok(!inkBody.includes("typed"), "typed text must not repeat in the ink note");
  assert.ok(!inkBody.includes("image-1.png"), "the placed image is not repeated in the ink note");
  // One upload for the placed image on the canvas, one for the ink printout.
  assert.equal(fake.uploads.filter((u) => u.pageId === b.id).length, 1);
  assert.equal(fake.uploads.filter((u) => u.pageId === ink.id).length, 1);
});
