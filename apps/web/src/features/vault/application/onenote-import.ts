import { getContainer } from "@/bootstrap";
import { composeOnPage } from "@/features/ink/application/parts-2";
import { readyCore, typedCore } from "@/lib/rust-core";
import { INK_NOTE_MAX_PAGES, encodeInkChunk } from "@weaveforge/core";
import type { OneNoteBackground, OneNoteImage, OneNoteInkPage, OneNoteSection } from "@weaveforge/wasm";

/** Where a printout sits on its ink page, in page units. */
export interface PageBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The slice of the vault and ink facades a OneNote import writes through. */
export interface OneNoteImportDeps {
  /** Parses the `.one` bytes; throws on a file that is not a OneNote section. */
  parse(bytes: Uint8Array, fileName: string): OneNoteSection;
  pageTitles(): Promise<readonly string[]>;
  add(input: {
    title: string;
    body?: string;
    parentId?: string;
    folder?: boolean;
    kind?: "canvas";
  }): Promise<{ id: string }>;
  update(id: string, body: string): Promise<void>;
  uploadAsset(pageId: string, blob: Blob, ext: string): Promise<string>;
  /** Draws a printout at `box` on a transparent page of the given size. */
  composeBackground(
    image: Blob,
    box: PageBox,
    pageWidth: number,
    pageHeight: number,
  ): Promise<{ blob: Blob; ext: string }>;
  writeChunk(noteId: string, chunkId: string, bytes: Uint8Array): Promise<void>;
}

export interface OneNoteImportResult {
  created: number;
  inkNotes: number;
  images: number;
  warnings: string[];
}

/** How an import lays out each OneNote page. */
export interface OneNoteImportOptions {
  /** Each page becomes a canvas of its positioned pieces instead of a note. */
  canvas?: boolean;
}

type OneNotePage = OneNoteSection["pages"][number];

/**
 * Imports one OneNote `.one` section into the vault: a note per page, nested
 * by outline level. A page with ink becomes one ink note, a printout per ink
 * page; one past the ink note's page limit splits into numbered parts. With
 * `canvas`, each page becomes a canvas instead, with its ink notes under it.
 * Pages go in sequentially so each child can take its parent's id.
 */
export async function importOneNoteSection(
  file: File,
  deps: OneNoteImportDeps,
  options: OneNoteImportOptions = {},
): Promise<OneNoteImportResult> {
  const canvas = options.canvas === true;
  const section = deps.parse(new Uint8Array(await file.arrayBuffer()), file.name);
  const warnings: string[] = [...section.warnings];

  const noteNames = section.pages.flatMap((page) => pageNoteNames(page, canvas));
  const plan = readyCore().planImportTitles([], noteNames, await deps.pageTitles());

  // Stack of ancestors by level: the nearest earlier page with a lower level is the parent.
  const stack: { level: number; id: string }[] = [];
  let nameIndex = 0;
  let created = 0;
  let inkNotes = 0;
  let images = 0;

  for (const page of section.pages) {
    while (stack.length && stack[stack.length - 1]!.level >= page.level) stack.pop();
    const parentId = stack.length ? stack[stack.length - 1]!.id : undefined;

    if (canvas) {
      const count = pageNoteNames(page, true).length;
      const titles = plan.noteTitles.slice(nameIndex, nameIndex + count);
      nameIndex += count;
      const written = await writeCanvasPage(page, titles, parentId, deps, warnings);
      stack.push({ level: page.level, id: written.id });
      created += 1 + written.inkNotes;
      inkNotes += written.inkNotes;
      images += written.images;
      continue;
    }

    if (page.ink.length === 0) {
      const title = plan.noteTitles[nameIndex++]!;
      const text = await deps.add({ title, body: page.markdown, parentId });
      stack.push({ level: page.level, id: text.id });
      created += 1;
      const linked = await attachImages(text.id, title, page.markdown, page.images, deps, warnings);
      images += linked.uploaded;
      if (linked.body !== page.markdown) await deps.update(text.id, linked.body);
      continue;
    }

    let first: string | undefined;
    for (let start = 0; start < page.ink.length; start += INK_NOTE_MAX_PAGES) {
      const title = plan.noteTitles[nameIndex++]!;
      const sheets = page.ink.slice(start, start + INK_NOTE_MAX_PAGES);
      const note = await writeInkNote(title, parentId, sheets, page.images, deps, warnings);
      first ??= note.id;
      images += note.uploaded;
      created += 1;
      inkNotes += 1;
    }
    stack.push({ level: page.level, id: first! });
  }

  return { created, inkNotes, images, warnings };
}

function partTitle(title: string, part: number): string {
  return part === 1 ? title : `${title} (part ${part})`;
}

function handwritingTitle(title: string, part: number): string {
  return part === 1 ? `${title} (handwriting)` : `${title} (handwriting, part ${part})`;
}

/** Note names a page needs for title clashes: its canvas first, then its ink parts. */
function pageNoteNames(page: OneNotePage, canvas: boolean): string[] {
  const inkParts = Math.ceil(page.ink.length / INK_NOTE_MAX_PAGES);
  const names = canvas ? [page.title] : [];
  const parts = canvas ? inkParts : Math.max(1, inkParts);
  for (let part = 1; part <= parts; part += 1) {
    names.push(canvas ? handwritingTitle(page.title, part) : partTitle(page.title, part));
  }
  return names.map((name) => `${name}.md`);
}

/**
 * A page as a canvas. Its placed images upload first, its ink notes are
 * written under the canvas, and the canvas body follows once every file has a
 * path. An image that fails to upload is left off the canvas.
 */
async function writeCanvasPage(
  page: OneNotePage,
  titles: readonly string[],
  parentId: string | undefined,
  deps: OneNoteImportDeps,
  warnings: string[],
): Promise<{ id: string; inkNotes: number; images: number }> {
  const [canvasTitle, ...inkTitles] = titles;
  const canvas = await deps.add({ title: canvasTitle!, parentId, kind: "canvas" });
  const files: Record<string, string> = {};
  let images = 0;

  // A printout behind ink lives in its ink note, so only placed images upload here.
  const placed = new Set(page.layout.filter((item) => item.kind === "image").map((item) => item.key));
  for (const image of page.images) {
    if (!placed.has(image.name)) continue;
    try {
      files[image.name] = await deps.uploadAsset(canvas.id, imageBlob(image), extensionOf(image.name));
      images += 1;
    } catch {
      warnings.push(`Image ${image.name} on "${canvasTitle}" not imported`);
    }
  }

  for (const [index, title] of inkTitles.entries()) {
    const start = index * INK_NOTE_MAX_PAGES;
    const sheets = page.ink.slice(start, start + INK_NOTE_MAX_PAGES);
    const note = await writeInkNote(title!, canvas.id, sheets, page.images, deps, warnings);
    files[`ink-${index}`] = `notes/${title}.note.md`;
    images += note.uploaded;
  }

  await deps.update(canvas.id, readyCore().oneNoteCanvasText(page.layout, files));
  return { id: canvas.id, inkNotes: inkTitles.length, images };
}

/**
 * Uploads each image `markdown` refers to and rewrites the reference to the
 * vault image. A failed upload drops the image to its alt text, so the note
 * stays readable.
 */
async function attachImages(
  pageId: string,
  title: string,
  markdown: string,
  pageImages: readonly OneNoteImage[],
  deps: OneNoteImportDeps,
  warnings: string[],
): Promise<{ body: string; uploaded: number }> {
  let body = markdown;
  let uploaded = 0;
  for (const image of pageImages) {
    if (!body.includes(`](${image.name})`)) continue;
    const ref = new RegExp(`!\\[([^\\]]*)\\]\\(${escapeRegExp(image.name)}\\)`, "g");
    let path: string | null = null;
    try {
      path = await deps.uploadAsset(pageId, imageBlob(image), extensionOf(image.name));
    } catch {
      path = null;
    }
    if (path === null) {
      warnings.push(`Image ${image.name} on "${title}" not imported`);
      body = body.replace(ref, (_match: string, alt: string) => alt);
    } else {
      uploaded += 1;
      const src = `${readyCore().vaultImagePrefix()}${path}`;
      body = body.replace(ref, (_match: string, alt: string) => readyCore().markdownImage(src, alt || imageAlt(image)));
    }
  }
  return { body, uploaded };
}

/**
 * An ink note: one chunk per sheet, its printout as the page background and
 * its typed text as the page's text layer. The note exists first so uploads
 * can sit under it; the body is rewritten once every upload has a path.
 */
async function writeInkNote(
  title: string,
  parentId: string | undefined,
  sheets: readonly OneNoteInkPage[],
  pageImages: readonly OneNoteImage[],
  deps: OneNoteImportDeps,
  warnings: string[],
): Promise<{ id: string; uploaded: number }> {
  const chunkIds = sheets.map(() => typedCore().newInkChunkId());
  const meta = { ...readyCore().defaultInkNoteMeta(), pages: sheets.length, pageOrder: chunkIds };
  const note = await deps.add({ title, body: readyCore().writeInkNoteBody(meta, ""), parentId });

  let uploaded = 0;
  const texts: string[] = [];
  const backgrounds: (string | null)[] = [];
  for (const [i, sheet] of sheets.entries()) {
    const linked = await attachImages(note.id, title, sheet.text, pageImages, deps, warnings);
    uploaded += linked.uploaded;
    const path = sheet.background
      ? await uploadBackground(note.id, sheet, sheet.background, pageImages, deps)
      : null;
    if (sheet.background && path === null) warnings.push(`Page ${i + 1} background on "${title}" not imported`);
    if (path !== null) uploaded += 1;
    texts.push(path === null ? linked.body : typedCore().withInkPageBackground(linked.body, path));
    backgrounds.push(path);
  }

  const body = readyCore().writeInkNoteBody(meta, typedCore().joinInkTextLayer(texts));
  await deps.update(note.id, body);
  for (const [i, sheet] of sheets.entries()) {
    const path = backgrounds[i];
    const background = path ? typedCore().inkAttachmentIndex(body, path) : 0;
    await deps.writeChunk(note.id, chunkIds[i]!, await encodeInkChunk({ ...sheet.page, background }));
  }
  return { id: note.id, uploaded };
}

/** Composes a sheet's printout onto its page and uploads it; `null` when either step fails. */
async function uploadBackground(
  noteId: string,
  sheet: OneNoteInkPage,
  background: OneNoteBackground,
  pageImages: readonly OneNoteImage[],
  deps: OneNoteImportDeps,
): Promise<string | null> {
  const image = pageImages.find((candidate) => candidate.name === background.name);
  if (!image) return null;
  try {
    const box = { x: background.x, y: background.y, width: background.width, height: background.height };
    const page = await deps.composeBackground(imageBlob(image), box, sheet.page.width, sheet.page.height);
    return await deps.uploadAsset(noteId, page.blob, page.ext);
  } catch {
    return null;
  }
}

function imageAlt(image: OneNoteImage): string {
  return image.alt || "image";
}

function imageBlob(image: OneNoteImage): Blob {
  return new Blob([decodeBase64(image.base64)], { type: `image/${extensionOf(image.name)}` });
}

function extensionOf(name: string): string {
  return name.slice(name.lastIndexOf(".") + 1);
}

function decodeBase64(base64: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Wires the import to the running app's vault and ink facades. */
export function oneNoteImportDeps(): OneNoteImportDeps {
  const container = getContainer();
  return {
    parse: (bytes, fileName) => readyCore().importOneNoteSection(bytes, fileName),
    pageTitles: () => container.vault.pageTitles(),
    add: (input) => container.vault.manageVaultPage.add(input),
    update: async (id, body) => {
      await container.vault.manageVaultPage.update(id, { body });
    },
    uploadAsset: (pageId, blob, ext) => container.vault.uploadAsset(pageId, blob, ext),
    composeBackground: composeOnPage,
    writeChunk: (noteId, chunkId, bytes) => container.ink.chunks.write(noteId, chunkId, bytes),
  };
}
