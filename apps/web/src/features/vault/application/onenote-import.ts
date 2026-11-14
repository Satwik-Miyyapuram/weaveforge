import { getContainer } from "@/bootstrap";
import { readyCore, typedCore } from "@/lib/rust-core";
import { encodeInkChunkBody } from "@weaveforge/core";
import type { OneNoteImage, OneNotePage, OneNoteSection } from "@weaveforge/wasm";

/** The slice of the vault and ink facades a OneNote import writes through. */
export interface OneNoteImportDeps {
  /** Parses the `.one` bytes; throws on a file that is not a OneNote section. */
  parse(bytes: Uint8Array, fileName: string): OneNoteSection;
  pageTitles(): Promise<readonly string[]>;
  add(input: { title: string; body?: string; parentId?: string; folder?: boolean }): Promise<{ id: string }>;
  update(id: string, body: string): Promise<void>;
  uploadAsset(pageId: string, blob: Blob, ext: string): Promise<string>;
  writeChunk(noteId: string, chunkId: string, bytes: Uint8Array): Promise<void>;
}

export interface OneNoteImportResult {
  created: number;
  inkNotes: number;
  images: number;
  warnings: string[];
}

const DEFAULT_SECTION = "OneNote";

/**
 * Imports one OneNote `.one` section into the vault: a folder for the section,
 * a note per page nested by outline level, a handwriting note per page with ink.
 * Pages go in sequentially so each child can take its parent's id.
 */
export async function importOneNoteSection(file: File, deps: OneNoteImportDeps): Promise<OneNoteImportResult> {
  const section = deps.parse(new Uint8Array(await file.arrayBuffer()), file.name);
  const warnings: string[] = [...section.warnings];

  const folderName = section.name || DEFAULT_SECTION;
  const inkTitle = (title: string) => `${title} (handwriting)`;
  const noteNames: string[] = [];
  for (const page of section.pages) {
    noteNames.push(`${page.title}.md`);
    if (page.ink.length > 0) noteNames.push(`${inkTitle(page.title)}.md`);
  }
  const plan = readyCore().planImportTitles([folderName], noteNames, await deps.pageTitles());

  const folder = await deps.add({ title: plan.folderTitles[0]!, folder: true });

  // Stack of ancestors by level: the nearest earlier page with a lower level is the parent.
  const stack: { level: number; id: string }[] = [];
  let nameIndex = 0;
  let created = 0;
  let inkNotes = 0;
  let images = 0;

  for (const page of section.pages) {
    while (stack.length && stack[stack.length - 1]!.level >= page.level) stack.pop();
    const parentId = stack.length ? stack[stack.length - 1]!.id : folder.id;
    const title = plan.noteTitles[nameIndex++]!;
    const inkNoteTitle = page.ink.length > 0 ? plan.noteTitles[nameIndex++]! : undefined;

    const text = await deps.add({ title, body: page.markdown, parentId });
    stack.push({ level: page.level, id: text.id });
    created += 1;

    const linked = await attachImages(text.id, title, page, deps, warnings);
    images += linked.uploaded;
    if (linked.changed) await deps.update(text.id, linked.body);

    if (inkNoteTitle !== undefined) {
      await writeInkNote(inkNoteTitle, parentId, page, deps);
      created += 1;
      inkNotes += 1;
    }
  }

  return { created, inkNotes, images, warnings };
}

/**
 * Uploads each image of a page and rewrites its reference to the vault image.
 * A failed upload drops the image to its alt text, so the note stays readable.
 */
async function attachImages(
  pageId: string,
  title: string,
  page: OneNotePage,
  deps: OneNoteImportDeps,
  warnings: string[],
): Promise<{ body: string; changed: boolean; uploaded: number }> {
  let body = page.markdown;
  let uploaded = 0;
  for (const image of page.images) {
    if (!body.includes(`](${image.name})`)) continue;
    const ref = new RegExp(`!\\[([^\\]]*)\\]\\(${escapeRegExp(image.name)}\\)`, "g");
    let path: string | null = null;
    try {
      path = await deps.uploadAsset(pageId, new Blob([decodeBase64(image.base64)]), extensionOf(image.name));
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
  return { body, changed: body !== page.markdown, uploaded };
}

/** A handwriting note: one chunk per ink page, the text layer in the note body. */
async function writeInkNote(
  title: string,
  parentId: string,
  page: OneNotePage,
  deps: OneNoteImportDeps,
): Promise<void> {
  const chunkIds = page.ink.map(() => typedCore().newInkChunkId());
  const body = readyCore().writeInkNoteBody(
    { ...readyCore().defaultInkNoteMeta(), pages: page.ink.length, pageOrder: chunkIds },
    page.inkText,
  );
  const note = await deps.add({ title, body, parentId });
  for (const [i, inkPage] of page.ink.entries()) {
    await deps.writeChunk(note.id, chunkIds[i]!, encodeInkChunkBody(inkPage));
  }
}

function imageAlt(image: OneNoteImage): string {
  return image.alt || "image";
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
    writeChunk: (noteId, chunkId, bytes) => container.ink.chunks.write(noteId, chunkId, bytes),
  };
}
