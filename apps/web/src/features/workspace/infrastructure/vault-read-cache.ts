/** Reads of the open folder kept in memory until our write or the shell's watcher says the file changed. */

type Stat = { path: string; kind: "file" | "dir"; size: number; modifiedAt: string } | null;

const TEXT_BUDGET = 8_000_000; // chars kept across all cached texts; oldest dropped first
const texts = new Map<string, Promise<string | null>>();
const sizes = new Map<string, number>(); // chars of each settled text entry
let total = 0;
const stats = new Map<string, Promise<Stat>>();
const lists = new Map<string, Promise<readonly NonNullable<Stat>[]>>();
let enabled = false; // only while a watcher is attached and not lost
const watched = new WeakSet<object>();

// The synced `.weaveforge/` entries, which the shell watcher does report
// (SYNCED_META_FILES and SYNCED_META_DIRS in git_policy.rs; a test keeps them equal).
const WATCHED_META_FILES = new Set(["workspace.json", "settings.json", "tags.json", "fields.json", "quotation-types.json"]);
const WATCHED_META_DIRS = new Set(["ai"]);

/**
 * False for paths the shell watcher does not report. The shell watcher ignores these
 * (vault_watcher.rs is_ignored), so nothing would ever tell us they changed.
 */
export function isCacheable(path: string): boolean {
  if (path === "") return false;
  if (path === ".git" || path.startsWith(".git/")) return false;
  if (path === ".weaveforge") return false;
  if (path.startsWith(".weaveforge/")) {
    const [name = "", ...rest] = path.slice(".weaveforge/".length).split("/");
    return rest.length === 0 ? WATCHED_META_FILES.has(name) : WATCHED_META_DIRS.has(name) && rest.length > 0;
  }
  return true;
}

export function cachedText(
  path: string,
  load: () => Promise<string | null>,
): Promise<string | null> {
  if (!enabled || !isCacheable(path)) return load();
  const hit = texts.get(path);
  if (hit) {
    texts.delete(path);
    texts.set(path, hit);
    return hit;
  }
  const p = load();
  texts.set(path, p);
  p.then(
    (text) => {
      if (texts.get(path) !== p) return;
      const n = text?.length ?? 0;
      sizes.set(path, n);
      total += n;
      evict();
    },
    () => {
      if (texts.get(path) === p) texts.delete(path);
    },
  );
  return p;
}

function evict(): void {
  while (total > TEXT_BUDGET) {
    const oldest = [...texts.keys()].find((key) => sizes.has(key));
    if (oldest === undefined) return;
    forgetText(oldest);
  }
}

export function cachedStat(path: string, load: () => Promise<Stat>): Promise<Stat> {
  if (!enabled || !isCacheable(path)) return load();
  const hit = stats.get(path);
  if (hit) return hit;
  const p = load();
  stats.set(path, p);
  p.then(undefined, () => {
    if (stats.get(path) === p) stats.delete(path);
  });
  return p;
}

export function cachedList(
  dir: string,
  load: () => Promise<readonly NonNullable<Stat>[]>,
): Promise<readonly NonNullable<Stat>[]> {
  if (!enabled || !(dir === "" || isCacheable(dir))) return load();
  const hit = lists.get(dir);
  if (hit) return hit;
  const p = load();
  lists.set(dir, p);
  p.then(undefined, () => {
    if (lists.get(dir) === p) lists.delete(dir);
  });
  return p;
}

export function forgetVaultPaths(paths: readonly string[]): void {
  if (paths.includes("\0overflow")) {
    forgetAll();
    return;
  }
  for (const path of paths) {
    forgetText(path);
    stats.delete(path);
    // A removed or renamed folder takes its files' cached reads with it.
    for (const key of [...texts.keys()]) if (key.startsWith(`${path}/`)) forgetText(key);
    for (const key of [...stats.keys()]) if (key.startsWith(`${path}/`)) stats.delete(key);
    // A write creates its parent folders: a cached "missing" stat of one would hide the file.
    for (let i = path.lastIndexOf("/"); i > 0; i = path.lastIndexOf("/", i - 1)) stats.delete(path.slice(0, i));
  }
  // Any change can add or drop an entry in some listing; lists are cheap to refetch.
  lists.clear();
}

export function forgetAll(): void {
  texts.clear();
  sizes.clear();
  stats.clear();
  lists.clear();
  total = 0;
}

export function watchVault(bridge: {
  onVaultChange?(cb: (paths: string[]) => void): () => void;
  onVaultWatchLost?(cb: (reason: string) => void): () => void;
}): void {
  // No watcher: never cache, since nothing would tell us a file changed.
  if (!bridge.onVaultChange) return;
  if (watched.has(bridge)) return;
  watched.add(bridge);
  bridge.onVaultChange((paths) => forgetVaultPaths(paths));
  // With no watcher, a cached read could hide an outside edit forever.
  bridge.onVaultWatchLost?.(() => {
    enabled = false;
    forgetAll();
  });
  enabled = true;
}

export function resetVaultCacheForTests(): void {
  forgetAll();
  enabled = false;
}

function forgetText(path: string): void {
  total -= sizes.get(path) ?? 0;
  sizes.delete(path);
  texts.delete(path);
}
