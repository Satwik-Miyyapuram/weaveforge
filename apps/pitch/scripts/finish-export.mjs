/**
 * Mark the export as not-Jekyll.
 *
 * GitHub Pages runs every published directory through Jekyll by default, and
 * Jekyll silently drops paths beginning with an underscore — which is every
 * file Next emits into `_next/`. The result is a page that serves its HTML
 * and 404s on all of its CSS and JavaScript. This empty file turns Jekyll off.
 *
 * Written at build time rather than committed so a local `npm run build`
 * produces exactly what CI publishes.
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(here, "../out/.nojekyll");

await writeFile(target, "");
console.log(`wrote ${path.relative(process.cwd(), target)}`);
