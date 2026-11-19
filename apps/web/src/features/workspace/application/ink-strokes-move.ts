import type { IWorkspaceFs } from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { logToApp } from "@/lib/error-report/app-log";

/**
 * Moving an ink note's strokes when the mirror renames or moves its file.
 *
 * Strokes live beside the note by name (`foo.ink.md` -> `foo.ink/`), so a
 * rename in the app must take the folder along. The mirror sees a rename as one
 * `.ink.md` written and one removed with the same `weaveforge-id`; this pairs
 * them and moves the folder before the old file is removed.
 *
 * Each page is written to `<name>.part`, read back, renamed into place and read
 * back again, so the new folder never holds half a page. Until every page is
 * copied, a failure removes only the files this run wrote and the old note is
 * kept, so the next sync tries again. Once every page is copied the move rolls
 * forward: the copy is never deleted, and an old page that cannot be removed is
 * left where it is and reported. A run cut off half way resumes, because a new
 * folder that holds only same-bytes copies of old pages is ours to finish.
 */

export interface InkMoveReport {
  level: "error" | "warn" | "info";
  message: string;
  detail?: string;
}

const INK_NOTE = ".ink.md";
const PART = ".part";
/** Where a case-only rename parks the strokes, since on most disks the two names are one folder. */
const CASE_STEP = ".moving";

/**
 * Moves the strokes folder of every renamed ink note.
 *
 * @param written the files this run writes, path -> text
 * @param removed the paths this run removes; still on disk when this runs
 * @returns the removed note paths that must stay on disk, because their strokes could not move
 */
export async function moveInkStrokes(
  core: RustCore,
  fs: IWorkspaceFs,
  written: Readonly<Record<string, string>>,
  removed: readonly string[],
  report: (entry: InkMoveReport) => void = (entry) => logToApp({ ...entry, source: "ink" }),
): Promise<string[]> {
  const newPathOf = new Map<string, string>();
  for (const [path, text] of Object.entries(written)) {
    if (!path.endsWith(INK_NOTE)) continue;
    const id = idOf(core, text);
    if (id) newPathOf.set(id, path);
  }
  const kept: string[] = [];
  for (const oldPath of removed) {
    if (!oldPath.endsWith(INK_NOTE)) continue;
    const text = await fs.readText(oldPath).catch(() => null);
    const id = text === null ? null : idOf(core, text);
    const newPath = id ? newPathOf.get(id) : undefined;
    if (!newPath || newPath === oldPath) continue;
    const from = core.inkStrokesDir(oldPath);
    const to = core.inkStrokesDir(newPath);
    // A case-only rename goes through a third name: on most disks `foo.ink` and `Foo.ink` are one folder.
    const steps: [string, string][] = from.toLowerCase() === to.toLowerCase()
      ? [[from, `${to}${CASE_STEP}`], [`${to}${CASE_STEP}`, to]]
      : [[from, to]];
    try {
      for (const [source, target] of steps) await moveFolder(fs, source, target, report);
    } catch (err) {
      report({ level: "error", message: `ink: could not move ${from} to ${to}; ${oldPath} was kept`, detail: String(err) });
      kept.push(oldPath);
    }
  }
  return kept;
}

/**
 * Copies `from` into `to` page by page, checks each copy, then removes `from`.
 * Throws only before every page is safe in `to`; after that it reports and returns.
 */
async function moveFolder(
  fs: IWorkspaceFs,
  from: string,
  to: string,
  report: (entry: InkMoveReport) => void,
): Promise<void> {
  if (!(await exists(fs, from))) return;
  const files = (await fs.list(from)).filter((entry) => entry.kind === "file").map((entry) => entry.path);
  const done = await alreadyCopied(fs, from, to);
  const made: string[] = [];
  try {
    await fs.mkdirp(to);
    for (const source of files) {
      const name = baseName(source);
      if (done.has(name)) continue;
      const destination = `${to}/${name}`;
      made.push(destination);
      await copyChecked(fs, source, destination);
    }
  } catch (err) {
    // Nothing of `from` is removed yet, so dropping what this run wrote loses nothing.
    for (const path of made) await fs.remove(path).catch(() => undefined);
    for (const path of made) await fs.remove(`${path}${PART}`).catch(() => undefined);
    if (done.size === 0) await removeIfEmpty(fs, to);
    throw err;
  }
  // Every page is safe in `to`; from here on nothing is undone.
  const left: string[] = [];
  const errors: string[] = [];
  for (const source of files) {
    try {
      await fs.remove(source);
    } catch (err) {
      left.push(source);
      errors.push(String(err));
    }
  }
  if (left.length > 0) {
    report({
      level: "warn",
      message: `ink: the strokes moved to ${to}, but ${left.length} old file(s) in ${from} could not be removed; they were left as they are`,
      detail: errors.join("\n"),
    });
    return;
  }
  await removeIfEmpty(fs, from);
}

/**
 * The page names a run cut off half way already copied into `to`. An unfinished
 * `.part` is dropped. Anything else in `to` that is not a same-bytes copy of a
 * page in `from` belongs to someone else, so the move refuses.
 */
async function alreadyCopied(fs: IWorkspaceFs, from: string, to: string): Promise<Set<string>> {
  const done = new Set<string>();
  if (!(await exists(fs, to))) return done;
  const parts: string[] = [];
  for (const entry of await fs.list(to)) {
    const name = baseName(entry.path);
    if (entry.kind === "file" && name.endsWith(PART)) {
      parts.push(entry.path);
      continue;
    }
    const source = `${from}/${name}`;
    const same = entry.kind === "file"
      && (await exists(fs, source))
      && sameBytes(await fs.readFile(entry.path), await fs.readFile(source));
    if (!same) throw new Error(`${to} already exists and holds ${entry.path}, which is not a copy of ${source}`);
    done.add(name);
  }
  // Only now is the folder known to be ours, so its unfinished `.part` files are too.
  for (const part of parts) await fs.remove(part);
  return done;
}

/** Writes `destination` through a `.part` file, so it is either whole or absent. */
async function copyChecked(fs: IWorkspaceFs, source: string, destination: string): Promise<void> {
  const bytes = await fs.readFile(source);
  const part = `${destination}${PART}`;
  await fs.writeFile(part, bytes);
  if (!sameBytes(await fs.readFile(part), bytes)) throw new Error(`${part} did not read back the same as ${source}`);
  await fs.rename(part, destination);
  if (!sameBytes(await fs.readFile(destination), bytes)) {
    throw new Error(`${destination} did not read back the same as ${source}`);
  }
}

async function removeIfEmpty(fs: IWorkspaceFs, dir: string): Promise<void> {
  try {
    if ((await exists(fs, dir)) && (await fs.list(dir)).length === 0) await fs.remove(dir, { recursive: true });
  } catch {
    // An empty folder left behind holds nothing.
  }
}

async function exists(fs: IWorkspaceFs, path: string): Promise<boolean> {
  return (await fs.stat(path).catch(() => null)) !== null;
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function idOf(core: RustCore, text: string): string | null {
  try {
    const id = core.readFrontmatter(text).frontmatter["weaveforge-id"];
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}
