/**
 * Copy the icons the exported site serves out of apps/web/public.
 *
 * Copied at build time rather than committed twice: a duplicated brand asset
 * is a duplicate that silently goes stale the first time the real one changes.
 */
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const from = path.resolve(here, "../../web/public/icons");
const to = path.resolve(here, "../public/icons");

await rm(to, { recursive: true, force: true });
await mkdir(path.dirname(to), { recursive: true });
await cp(from, to, { recursive: true });
console.log(`copied icons -> ${path.relative(process.cwd(), to)}`);
