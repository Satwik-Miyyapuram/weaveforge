import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";

/**
 * The local database written out as a backup straight from its data directory
 * on disk, streamed file by file.
 *
 * PGlite's own `dumpDataDir` builds the whole tarball in memory first: for a
 * database whose backup is 49 MB gzipped, main grew by about 380 MB every ten
 * minutes (M02). The data directory is already on disk, so the same tarball
 * is made here from the files, a block at a time, and memory stays flat.
 *
 * The tarball is the one PGlite makes and `PGlite.create({ loadDataDir })`
 * reads: ustar, every directory and file under the data directory, named from
 * its root with a leading slash (`/base/1/112`), mode 0777.
 */

/** The slice of PGlite a dump needs: a statement, and its query lock. */
export interface Exclusive {
  exec(sql: string): Promise<unknown>;
  runExclusive<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * Back up the engine running on `dir` into `file`.
 *
 * Checkpointed first, so the copy needs no recovery when it is loaded, then
 * copied while holding the engine's query lock: a statement that ran halfway
 * through the copy would leave its files torn between two moments. Queries
 * that arrive meanwhile wait and then run.
 */
export async function dumpOnDisk(engine: Exclusive, dir: string, file: string): Promise<void> {
  await engine.exec("CHECKPOINT");
  await engine.runExclusive(() => writeDataDirTarGz(dir, file));
}

/** Write the tree under `dir` to `file` as a gzipped tarball; no file on failure. */
export async function writeDataDirTarGz(dir: string, file: string): Promise<void> {
  // Checked before the file is made, so a missing directory leaves nothing.
  if (!(await fs.promises.stat(dir)).isDirectory()) throw new Error(`${dir} is not a directory`);
  try {
    await pipeline(Readable.from(tar(dir)), zlib.createGzip(), fs.createWriteStream(file));
  } catch (error) {
    await fs.promises.rm(file, { force: true }).catch(() => undefined);
    throw error;
  }
}

const BLOCK = 512;
const MODE = 0o777;
const MAX_SIZE = 8 ** 11 - 1;

async function* tar(root: string): AsyncGenerator<Buffer> {
  yield* tree(root, "");
  // The end of an archive is two empty blocks.
  yield Buffer.alloc(BLOCK * 2);
}

async function* tree(root: string, rel: string): AsyncGenerator<Buffer> {
  const entries = await fs.promises.readdir(path.join(root, rel), { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const child = `${rel}/${entry.name}`;
    const full = path.join(root, child);
    if (entry.isDirectory()) {
      const { mtime } = await fs.promises.stat(full);
      yield header(child, 0, mtime, "5");
      yield* tree(root, child);
    } else if (entry.isFile()) {
      yield* fileEntry(full, child);
    } else {
      // Nothing else belongs in a PGlite data directory; a backup that skipped
      // it would be a backup that is missing something.
      throw new Error(`cannot back up ${full}: not a file or directory`);
    }
  }
}

async function* fileEntry(full: string, name: string): AsyncGenerator<Buffer> {
  const { size, mtime } = await fs.promises.stat(full);
  yield header(name, size, mtime, "0");
  let read = 0;
  // Only as much as the header promised: the engine is locked, so the file
  // should not change, but a header that disagreed with its body would break
  // every entry after it.
  if (size > 0) {
    for await (const chunk of fs.createReadStream(full, { start: 0, end: size - 1 })) {
      read += (chunk as Buffer).length;
      yield chunk as Buffer;
    }
  }
  if (read !== size) throw new Error(`${full} changed size while it was backed up`);
  const pad = (BLOCK - (size % BLOCK)) % BLOCK;
  if (pad) yield Buffer.alloc(pad);
}

function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

/** Split a path between ustar's 155-byte prefix and 100-byte name fields. */
function splitName(name: string): { prefix: string; base: string } {
  if (Buffer.byteLength(name) <= 100) return { prefix: "", base: name };
  for (let i = name.lastIndexOf("/"); i > 0; i = name.lastIndexOf("/", i - 1)) {
    const prefix = name.slice(0, i);
    const base = name.slice(i + 1);
    if (Buffer.byteLength(base) > 100) break;
    if (Buffer.byteLength(prefix) <= 155) return { prefix, base };
  }
  throw new Error(`path too long for a backup: ${name}`);
}

function header(name: string, size: number, mtime: Date, type: "0" | "5"): Buffer {
  if (size > MAX_SIZE) throw new Error(`${name} is too large for a backup`);
  const { prefix, base } = splitName(name);
  const h = Buffer.alloc(BLOCK);
  h.write(base, 0, 100, "utf8");
  h.write(octal(MODE, 8), 100, "ascii");
  h.write(octal(0, 8), 108, "ascii");
  h.write(octal(0, 8), 116, "ascii");
  h.write(octal(size, 12), 124, "ascii");
  h.write(octal(Math.floor(mtime.getTime() / 1000), 12), 136, "ascii");
  h.write(" ".repeat(8), 148, "ascii");
  h.write(type, 156, "ascii");
  h.write("ustar\0", 257, "ascii");
  h.write("00", 263, "ascii");
  h.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const byte of h) sum += byte;
  h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
  return h;
}
