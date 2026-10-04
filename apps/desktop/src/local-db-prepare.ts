import fs from "node:fs";
import path from "node:path";

// Explorer/sync drops these into folders; Postgres fails on any stray entry in its data dir.
const JUNK_FILES = new Set(["desktop.ini", ".ds_store", "thumbs.db"]);

/**
 * Readies a data directory for PGlite: removes OS junk files and clears
 * read-only bits, since PGlite's in-WASM filesystem enforces the mode Node
 * reports and Windows' ReadOnly attribute leaves directories without a write bit.
 */
export function prepareDataDir(dir: string): void {
  if (!fs.existsSync(dir)) return;
  const walk = (p: string): void => {
    const stat = fs.statSync(p);
    if (!(stat.mode & 0o200)) fs.chmodSync(p, stat.mode | 0o200);
    if (!stat.isDirectory()) return;
    for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
      const child = path.join(p, entry.name);
      if (entry.isFile() && JUNK_FILES.has(entry.name.toLowerCase())) {
        fs.rmSync(child, { force: true });
        continue;
      }
      walk(child);
    }
  };
  walk(dir);
}
