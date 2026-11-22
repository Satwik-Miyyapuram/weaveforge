/**
 * Files-only blob store (0.9.7): images and experiment artifacts live as files under
 * `assets/<bucket>/<path>`, with a `.sha256` sidecar. No database row.
 *
 * Layout matches `asset_path` in `crates/wf-core/src/sync/folder_layout.rs`; the
 * `assets` prefix is hard-coded here (`ASSET_DIR`) so no wasm export is needed.
 */
import { BlobNotFoundError, type IBlobFetcher, type IWorkspaceFs } from "@weaveforge/core";
import { moveToTrash } from "@/lib/workspace-trash";
import { conflictCopyPath } from "@/features/migration-097/domain/conflict-path";

/** `ASSET_DIR` in crates/wf-core/src/sync/folder_layout.rs. */
const ASSET_DIR = "assets";

/** Every bucket and path is one relative name; `.sha256` is reserved for sidecars. */
function assertSafe(bucket: string, path: string): void {
  const unsafe =
    !bucket ||
    !path ||
    bucket.includes("/") ||
    [bucket, path].some((part) => part.includes("..") || part.startsWith("/") || part.includes("\\")) ||
    path.endsWith(".sha256");
  if (unsafe) throw new Error(`Unsafe asset path: ${bucket}/${path}`);
}

/** Writes through a `.part` file and a rename, so a crash never leaves a half-written asset. */
async function writeAtomic(fs: IWorkspaceFs, file: string, data: Uint8Array | string): Promise<void> {
  await fs.writeFile(`${file}.part`, data);
  await fs.rename(`${file}.part`, file);
}

/**
 * Writes a sidecar without ever renaming onto an existing one. The same text is already there: nothing to do.
 * Different text keeps the existing sidecar and goes to the first free conflict copy beside it.
 */
async function putSidecar(fs: IWorkspaceFs, sidecar: string, text: string): Promise<void> {
  for (let n = 0; ; n++) {
    const target = n === 0 ? sidecar : conflictCopyPath(sidecar, n);
    if (!(await fs.stat(target))) return writeAtomic(fs, target, text);
    if ((await fs.readText(target)) === text) return;
  }
}

function assetFile(bucket: string, path: string): string {
  return `${ASSET_DIR}/${bucket}/${path}`;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export class FileBlobStore implements IBlobFetcher {
  constructor(private readonly fs: IWorkspaceFs) {}

  async upload(bucket: string, path: string, blob: Blob, contentType?: string): Promise<void> {
    assertSafe(bucket, path);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const type = contentType || blob.type || "application/octet-stream";
    const digest = await sha256Hex(bytes);
    const file = assetFile(bucket, path);
    // Never replace bytes silently: the same path must hold the same content.
    if (await this.fs.stat(file)) {
      if ((await sha256Hex(await this.fs.readFile(file))) !== digest) {
        throw new Error(`${file} already holds different bytes; not overwritten.`);
      }
    } else {
      await this.fs.mkdirp(file.slice(0, file.lastIndexOf("/")));
      await writeAtomic(this.fs, file, bytes);
    }
    await putSidecar(this.fs, `${file}.sha256`, `${digest}\n${type}`);
  }

  /** Moves the bytes and sidecar to `.weaveforge/trash`; nothing is unlinked. */
  async remove(bucket: string, path: string): Promise<void> {
    assertSafe(bucket, path);
    const file = assetFile(bucket, path);
    for (const target of [file, `${file}.sha256`]) {
      if (await this.fs.stat(target)) await moveToTrash(this.fs, target, Date.now());
    }
  }

  /** Local files are not served by signed URLs; read them with `fetchBytes`. */
  async signedUrls(_bucket: string, paths: string[], _ttlSeconds: number): Promise<(string | null)[]> {
    return paths.map(() => null);
  }

  async fetchBytes(bucket: string, path: string): Promise<Uint8Array> {
    assertSafe(bucket, path);
    const file = assetFile(bucket, path);
    if (!(await this.fs.stat(file))) throw new BlobNotFoundError(bucket, path);
    const bytes = await this.fs.readFile(file);
    const sidecar = `${file}.sha256`;
    // A missing sidecar yields "" here, which never matches: unverified bytes are not returned.
    const expected = (await this.fs.stat(sidecar)) ? (await this.fs.readText(sidecar)).split("\n")[0] : "";
    if ((await sha256Hex(bytes)) !== expected) throw new Error(`asset checksum mismatch: ${file}`);
    return bytes;
  }

  async fetchBlob(bucket: string, path: string, fallbackContentType?: string): Promise<Blob> {
    const bytes = await this.fetchBytes(bucket, path);
    const type = (await this.fs.readText(`${assetFile(bucket, path)}.sha256`)).split("\n")[1];
    return new Blob([new Uint8Array(bytes)], { type: type || fallbackContentType || "application/octet-stream" });
  }

  async fetchBlobs(
    bucket: string,
    paths: readonly string[],
    fallbackContentType?: string,
  ): Promise<Map<string, Blob>> {
    const blobs = new Map<string, Blob>();
    for (const path of paths) blobs.set(path, await this.fetchBlob(bucket, path, fallbackContentType));
    return blobs;
  }
}
