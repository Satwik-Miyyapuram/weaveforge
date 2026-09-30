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
  entityDir,
  paperPdfPath,
  type IPdfByteCache,
  type IWorkspaceFs,
} from "@weaveforge/core";

export class WorkspacePdfStore implements IPdfByteCache {
  /**
   * `projectRoot` is a function, not a string: the reader can switch project
   * without this store being rebuilt, and a cached root would then file one
   * project's PDFs under another's folder.
   */
  constructor(
    private readonly fs: () => IWorkspaceFs | null,
    private readonly projectRoot: () => Promise<string>,
  ) {}

  async get(key: string): Promise<ArrayBuffer | null> {
    const fs = this.fs();
    if (!fs) return null;
    const path = paperPdfPath(key, await this.projectRoot());
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
    const root = await this.projectRoot();
    await fs.mkdirp(entityDir("paper", root) + "/pdf");
    await fs.writeFile(paperPdfPath(key, root), new Uint8Array(bytes));
  }

  async remove(key: string): Promise<void> {
    const fs = this.fs();
    if (!fs) return;
    const path = paperPdfPath(key, await this.projectRoot());
    if (await fs.stat(path)) await fs.remove(path);
  }

  async clear(): Promise<void> {
    const fs = this.fs();
    if (!fs) return;
    // This project's copies only: another project's PDFs are not this cache's.
    const dir = entityDir("paper", await this.projectRoot()) + "/pdf";
    if (await fs.stat(dir)) await fs.remove(dir, { recursive: true });
  }

  async size(): Promise<number> {
    const fs = this.fs();
    if (!fs) return 0;
    const dir = entityDir("paper", await this.projectRoot()) + "/pdf";
    if (!(await fs.stat(dir))) return 0;
    const entries = await fs.list(dir);
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
