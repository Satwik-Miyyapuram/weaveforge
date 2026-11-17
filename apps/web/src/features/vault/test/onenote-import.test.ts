import { before, test } from "node:test";
import assert from "node:assert/strict";

import { loadTestCore } from "@/lib/test/load-test-core";
import { readyCore, typedCore } from "@/lib/rust-core";
import type { OneNoteInkPage, OneNoteSection } from "@weaveforge/wasm";
import { importOneNoteSection, type OneNoteImportDeps } from "../application/onenote-import";

before(async () => {
  await loadTestCore();
});

const PNG_BASE64 = Buffer.from([137, 80, 78, 71]).toString("base64");

/** One ink sheet at the origin, with a single stroke when `inked` is set. */
function sheet(inked: boolean): OneNoteInkPage {
  const page = typedCore().blankInkPage("blank");
  if (inked) {
    page.strokes.push({
      points: [0, 0, 127, 127],
      pressures: [0, 255],
      width: 127,
      tool: "pen",
      colour: "text",
      t0: 0,
      shape: "none",
      lineIndex: -1,
    } as unknown as (typeof page.strokes)[number]);
  }
  return { page, background: null, text: "", originX: 0, originY: 0 } as unknown as OneNoteInkPage;
}

/**
 * A section of three pages. Page A has typed text and one picture; page B has
 * typed text, a placed picture and two ink sheets, one with a stroke; page C is
 * plain text.
 */
function fakeSection(): OneNoteSection {
  const image = (name: string) => ({ name, alt: "pic", base64: PNG_BASE64 });
  const text = (x: number, y: number, body: string) => ({ kind: "text", key: "", text: body, x, y, width: 100, height: 40 });
  const picture = (key: string) => ({ kind: "image", key, text: "pic", x: 10, y: 60, width: 50, height: 50 });
  return {
    name: "Lab",
    warnings: ["Page 9 skipped"],
    pages: [
      {
        title: "A",
        level: 0,
        markdown: "x ![pic](image-1.png) y",
        images: [image("image-1.png")],
        ink: [],
        layout: [text(0, 0, "x y"), picture("image-1.png")],
      },
      {
        title: "B",
        level: 1,
        markdown: "typed",
        images: [image("image-2.png")],
        ink: [sheet(true), sheet(false)],
        layout: [text(0, 0, "typed"), picture("image-2.png")],
      },
      { title: "C", level: 0, markdown: "c", images: [], ink: [], layout: [text(0, 0, "c")] },
    ],
  } as unknown as OneNoteSection;
}

/**
 * Deps that record every call. `failUpload` makes uploadAsset reject;
 * `failAddTitle` makes add reject for that page title.
 */
function fakeDeps(opts: { failUpload?: boolean; failAddTitle?: string } = {}) {
  let next = 0;
  const adds: { title: string; parentId?: string; kind?: string; folder?: boolean; id: string }[] = [];
  const updates: { id: string; body: string }[] = [];
  const uploads: { pageId: string; ext: string; path: string }[] = [];
  const removed: string[] = [];
  const deps: OneNoteImportDeps = {
    parse: () => fakeSection(),
    async pageTitles() {
      return ["Taken"];
    },
    async add(input) {
      if (opts.failAddTitle === input.title) throw new Error("write refused");
      const id = `id-${next++}`;
      adds.push({ ...input, id });
      return { id };
    },
    async remove(id) {
      removed.push(id);
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
  };
  return { deps, adds, updates, uploads, removed };
}

function sectionFile(): File {
  return new File([new Uint8Array([1, 2, 3])], "Lab.one");
}

/** The canvas body last written for `id`, else the one it was added with. */
function finalBody(fake: ReturnType<typeof fakeDeps>, id: string): string {
  const updated = fake.updates.filter((u) => u.id === id).at(-1);
  return updated?.body ?? "";
}

interface CanvasNodeJson {
  id: string;
  type: string;
  text?: string;
  file?: string;
}

function canvasOf(body: string): { nodes: CanvasNodeJson[]; wfInk: { id: string }[] } {
  const parsed = JSON.parse(body);
  return { nodes: parsed.nodes ?? [], wfInk: parsed.wfInk ?? [] };
}

test("a OneNote section imports as nested freeform pages (OneNote)", async () => {
  const fake = fakeDeps();
  const out = await importOneNoteSection(sectionFile(), fake.deps);

  assert.deepEqual(
    fake.adds.map((a) => a.title),
    ["A", "B", "C"],
  );
  assert.ok(fake.adds.every((a) => a.kind === "canvas"));
  assert.ok(fake.adds.every((a) => !a.folder));
  const byTitle = new Map(fake.adds.map((a) => [a.title, a]));
  assert.equal(byTitle.get("A")!.parentId, undefined);
  assert.equal(byTitle.get("B")!.parentId, byTitle.get("A")!.id);
  assert.equal(byTitle.get("C")!.parentId, undefined);

  assert.equal(out.created, 3);
  assert.deepEqual(out.warnings, ["Page 9 skipped"]);
});

test("each page's typed text becomes a text node at its position (OneNote)", async () => {
  const fake = fakeDeps();
  await importOneNoteSection(sectionFile(), fake.deps);

  const pageC = fake.adds.find((a) => a.title === "C")!;
  const canvas = canvasOf(finalBody(fake, pageC.id));
  const texts = canvas.nodes.filter((n) => n.type === "text");
  assert.equal(texts.length, 1);
  assert.equal(texts[0]!.text, "c");
});

test("a placed picture is uploaded under its canvas and linked as a file node (OneNote)", async () => {
  const fake = fakeDeps();
  const out = await importOneNoteSection(sectionFile(), fake.deps);

  const pageB = fake.adds.find((a) => a.title === "B")!;
  const upload = fake.uploads.find((u) => u.pageId === pageB.id)!;
  assert.equal(upload.ext, "png");
  const canvas = canvasOf(finalBody(fake, pageB.id));
  const files = canvas.nodes.filter((n) => n.type === "file");
  assert.equal(files.length, 1);
  assert.equal(files[0]!.file, upload.path);
  // Page A's picture and page B's picture.
  assert.equal(out.images, 2);
});

test("ink strokes land in the canvas's top-level ink layer (OneNote)", async () => {
  const fake = fakeDeps();
  await importOneNoteSection(sectionFile(), fake.deps);

  const pageB = fake.adds.find((a) => a.title === "B")!;
  const canvas = canvasOf(finalBody(fake, pageB.id));
  assert.equal(canvas.wfInk.length, 1);
  assert.ok(canvas.wfInk[0]!.id.startsWith("ink-"));
});

test("a page body is normalised canvas text (OneNote)", async () => {
  const fake = fakeDeps();
  await importOneNoteSection(sectionFile(), fake.deps);

  for (const page of fake.adds) {
    const body = finalBody(fake, page.id);
    assert.equal(readyCore().normalizeCanvasText(body), body);
  }
});

test("a failed upload warns, drops the picture and keeps the text (OneNote)", async () => {
  const fake = fakeDeps({ failUpload: true });
  const out = await importOneNoteSection(sectionFile(), fake.deps);

  assert.ok(out.warnings.includes('Image image-2.png on "B" not imported'));
  assert.equal(out.images, 0);
  const pageB = fake.adds.find((a) => a.title === "B")!;
  const canvas = canvasOf(finalBody(fake, pageB.id));
  assert.equal(canvas.nodes.filter((n) => n.type === "file").length, 0);
  assert.ok(canvas.nodes.some((n) => n.type === "text" && n.text === "typed"));
  // The page itself still lands.
  assert.equal(out.created, 3);
});

test("a failed page write removes the pages already made, newest first, then rethrows (OneNote)", async () => {
  const fake = fakeDeps({ failAddTitle: "C" });

  await assert.rejects(importOneNoteSection(sectionFile(), fake.deps), /write refused/);

  // A and B were created before C failed; B (the child) goes first.
  const [idA, idB] = [fake.adds[0]!.id, fake.adds[1]!.id];
  assert.deepEqual(fake.removed, [idB, idA]);
});
