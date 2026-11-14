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
  const adds: { title: string; body?: string; parentId?: string; folder?: boolean; id: string }[] = [];
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
