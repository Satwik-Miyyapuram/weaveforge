/**
 * The folder's PDFs (ladder step 1 on desktop): `papers/pdf/<paperId>.pdf`
 * in the workspace folder, so a paper fetched once is on disk for good —
 * no network, no eviction — and travels with the folder.
 *
 * Implements the same byte-cache port the browser's IndexedDB store does, so
 * the ladder is unchanged: the routed store below picks this one while a
 * folder is open and the browser cache otherwise, which is what makes the
 * web build fetch online and the desktop build read from setup.
 */

import {
  PAPER_PDF_DIR,
  paperPdfPath,
  type IPdfByteCache,
  type IWorkspaceFs,
} from "@weaveforge/core";

export class WorkspacePdfStore implements IPdfByteCache {
  constructor(private readonly fs: () => IWorkspaceFs | null) {}

  async get(key: string): Promise<ArrayBuffer | null> {
    const fs = this.fs();
    if (!fs) return null;
    const path = paperPdfPath(key);
    if (!(await fs.stat(path))) return null;
    const bytes = await fs.readFile(path);
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
  }

  async set(key: string, bytes: ArrayBuffer): Promise<void> {
    const fs = this.fs();
    if (!fs) return;
    await fs.mkdirp(PAPER_PDF_DIR);
    await fs.writeFile(paperPdfPath(key), new Uint8Array(bytes));
  }

  async remove(key: string): Promise<void> {
    const fs = this.fs();
    if (!fs) return;
    const path = paperPdfPath(key);
    if (await fs.stat(path)) await fs.remove(path);
  }

  async clear(): Promise<void> {
    const fs = this.fs();
    if (!fs) return;
    if (await fs.stat(PAPER_PDF_DIR))
      await fs.remove(PAPER_PDF_DIR, { recursive: true });
  }

  async size(): Promise<number> {
    const fs = this.fs();
    if (!fs || !(await fs.stat(PAPER_PDF_DIR))) return 0;
    const entries = await fs.list(PAPER_PDF_DIR);
    return entries.filter((entry) => entry.kind === "file").length;
  }
}

/** The store the reader is handed: decided per call, as a folder can open or close mid-session. */
export class RoutedPdfByteCache implements IPdfByteCache {
  constructor(private readonly pick: () => IPdfByteCache) {}

  get(key: string) {
    return this.pick().get(key);
  }
  set(key: string, bytes: ArrayBuffer) {
    return this.pick().set(key, bytes);
  }
  remove(key: string) {
    return this.pick().remove(key);
  }
  clear() {
    return this.pick().clear();
  }
  size() {
    return this.pick().size();
  }
}
