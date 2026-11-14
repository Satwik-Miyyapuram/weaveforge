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

/** A section with a page that has an image, a child page with ink, and a sibling page. */
function fakeSection(): OneNoteSection {
  return {
    name: "Lab",
    warnings: ["Page 9 skipped"],
    pages: [
      {
        title: "A",
        level: 0,
        markdown: "x ![pic](image-1.png) y",
        images: [{ name: "image-1.png", alt: "pic", base64: PNG_BASE64 }],
        ink: [],
        inkText: "",
      },
      {
        title: "B",
        level: 1,
        markdown: "",
        images: [],
        ink: [typedCore().blankInkPage("blank")],
        inkText: "hello",
      },
      { title: "C", level: 0, markdown: "c", images: [], ink: [], inkText: "" },
    ],
  } as unknown as OneNoteSection;
}

/** Deps that record every call; `failUpload` makes uploadAsset reject. */
function fakeDeps(opts: { failUpload?: boolean } = {}) {
  let next = 0;
  const adds: { title: string; body?: string; parentId?: string; folder?: boolean; id: string }[] = [];
  const updates: { id: string; body: string }[] = [];
  const uploads: { pageId: string; ext: string; id: string }[] = [];
  const chunks: { noteId: string; chunkId: string; bytes: Uint8Array }[] = [];
  const deps: OneNoteImportDeps = {
    parse: () => fakeSection(),
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
      uploads.push({ pageId, ext, id: "up" });
      return "user/p/image-1.png";
    },
    async writeChunk(noteId, chunkId, bytes) {
      chunks.push({ noteId, chunkId, bytes });
    },
  };
  return { deps, adds, updates, uploads, chunks };
}

function sectionFile(): File {
  return new File([new Uint8Array([1, 2, 3])], "Lab.one");
}

test("a OneNote section imports as a folder, nested pages and a handwriting note (OneNote)", async () => {
  const fake = fakeDeps();
  const out = await importOneNoteSection(sectionFile(), fake.deps);

  const folder = fake.adds[0]!;
  assert.equal(folder.folder, true);
  const byTitle = new Map(fake.adds.map((a) => [a.title, a]));
  assert.equal(byTitle.get("B")!.parentId, byTitle.get("A")!.id);
  assert.equal(byTitle.get("C")!.parentId, folder.id);

  const ink = byTitle.get("B (handwriting)")!;
  assert.equal(ink.parentId, byTitle.get("B")!.parentId);
  assert.equal(fake.chunks.length, 1);
  assert.equal(fake.chunks[0]!.noteId, ink.id);
  // A stored chunk is a whole chunk (header + body), so the ink page can read it back.
  await assert.doesNotReject(decodeInkChunk(fake.chunks[0]!.bytes));

  assert.equal(out.created, 4);
  assert.equal(out.inkNotes, 1);
  assert.equal(out.images, 1);
  assert.deepEqual(out.warnings, ["Page 9 skipped"]);
});

test("an image is uploaded under its page and the body points at the vault image (OneNote)", async () => {
  const fake = fakeDeps();
  await importOneNoteSection(sectionFile(), fake.deps);

  assert.equal(fake.uploads.length, 1);
  assert.equal(fake.uploads[0]!.ext, "png");
  const pageA = fake.adds.find((a) => a.title === "A")!;
  assert.equal(fake.uploads[0]!.pageId, pageA.id);
  const update = fake.updates.find((u) => u.id === pageA.id)!;
  assert.ok(update.body.includes(`${readyCore().vaultImagePrefix()}user/p/image-1.png`));
  assert.ok(!update.body.includes("](image-1.png)"));
});

test("a failed upload warns, drops the image and still resolves (OneNote)", async () => {
  const fake = fakeDeps({ failUpload: true });
  const out = await importOneNoteSection(sectionFile(), fake.deps);

  assert.ok(out.warnings.includes('Image image-1.png on "A" not imported'));
  const pageA = fake.adds.find((a) => a.title === "A")!;
  const update = fake.updates.find((u) => u.id === pageA.id)!;
  assert.ok(!update.body.includes("image-1.png"));
  assert.equal(out.images, 0);
});
