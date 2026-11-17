import { getContainer } from "@/bootstrap";
import { readyCore } from "@/lib/rust-core";
import type { OneNoteImage, OneNotePage, OneNoteSection } from "@weaveforge/wasm";

/** The slice of the vault facade a OneNote import writes through. */
export interface OneNoteImportDeps {
  /** Parses the `.one` bytes; throws on a file that is not a OneNote section. */
  parse(bytes: Uint8Array, fileName: string): OneNoteSection;
  pageTitles(): Promise<readonly string[]>;
  add(input: { title: string; parentId?: string; kind: "canvas" }): Promise<{ id: string }>;
  update(id: string, body: string): Promise<void>;
  /** Deletes a page this import created, when the import has to be undone. */
  remove(id: string): Promise<void>;
  uploadAsset(pageId: string, blob: Blob, ext: string): Promise<string>;
}

export interface OneNoteImportResult {
  created: number;
  images: number;
  warnings: string[];
}

/**
 * Imports one OneNote `.one` section into the vault. Each OneNote page becomes
 * one freeform page (a canvas): typed text at its OneNote position, pictures as
 * file nodes and handwriting as ink strokes. Outline levels nest the pages.
 * Pages go in sequentially so each child can take its parent's id. A failed
 * write removes the pages this import already made, then rethrows, so a
 * half-imported section does not stay in the vault.
 */
export async function importOneNoteSection(file: File, deps: OneNoteImportDeps): Promise<OneNoteImportResult> {
  const section = deps.parse(new Uint8Array(await file.arrayBuffer()), file.name);
  const warnings: string[] = [...section.warnings];
  const titles = readyCore().planImportTitles(
    [],
    section.pages.map((page) => page.title),
    await deps.pageTitles(),
  ).noteTitles;

  // Stack of ancestors by level: the nearest earlier page with a lower level is the parent.
  const stack: { level: number; id: string }[] = [];
  const created: string[] = [];
  let images = 0;

  try {
    for (const [index, page] of section.pages.entries()) {
      while (stack.length && stack[stack.length - 1]!.level >= page.level) stack.pop();
      const parentId = stack.length ? stack[stack.length - 1]!.id : undefined;

      const { id } = await deps.add({ title: titles[index]!, parentId, kind: "canvas" });
      created.push(id);
      stack.push({ level: page.level, id });

      const files = await uploadPictures(id, page, deps, warnings);
      images += Object.keys(files).length;
      const text = readyCore().oneNoteFreeformText(page.layout, files, page.ink);
      await deps.update(id, readyCore().normalizeCanvasText(text));
    }
  } catch (error) {
    await rollback(created, deps);
    throw error;
  }

  return { created: section.pages.length, images, warnings };
}

/**
 * Removes the pages made so far, newest first, so a child goes before its
 * parent. Best effort: a page that cannot be removed is left behind rather
 * than masking the error that caused the rollback.
 */
async function rollback(ids: readonly string[], deps: OneNoteImportDeps): Promise<void> {
  for (const id of [...ids].reverse()) {
    try {
      await deps.remove(id);
    } catch {
      // Keep removing the rest; the original write error is what the user sees.
    }
  }
}

/**
 * Uploads each picture the page places under the page's canvas. Maps each
 * picture's name to its vault path; a failed upload warns and leaves the
 * picture out, so the rest of the page still imports.
 */
async function uploadPictures(
  pageId: string,
  page: OneNotePage,
  deps: OneNoteImportDeps,
  warnings: string[],
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const image of page.images) {
    if (!page.layout.some((item) => item.kind === "image" && item.key === image.name)) continue;
    try {
      files[image.name] = await deps.uploadAsset(pageId, imageBlob(image), extensionOf(image.name));
    } catch {
      warnings.push(`Image ${image.name} on "${page.title}" not imported`);
    }
  }
  return files;
}

function imageBlob(image: OneNoteImage): Blob {
  return new Blob([decodeBase64(image.base64)], { type: `image/${extensionOf(image.name)}` });
}

function extensionOf(name: string): string {
  return name.slice(name.lastIndexOf(".") + 1);
}

function decodeBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Wires the import to the running app's vault facade. */
export function oneNoteImportDeps(): OneNoteImportDeps {
  const container = getContainer();
  return {
    parse: (bytes, fileName) => readyCore().importOneNoteSection(bytes, fileName),
    pageTitles: () => container.vault.pageTitles(),
    add: (input) => container.vault.manageVaultPage.add(input),
    update: async (id, body) => {
      await container.vault.manageVaultPage.update(id, { body });
    },
    remove: (id) => container.vault.manageVaultPage.remove(id),
    uploadAsset: (pageId, blob, ext) => container.vault.uploadAsset(pageId, blob, ext),
  };
}
