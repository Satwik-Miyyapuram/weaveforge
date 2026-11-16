/**
 * Writes the /docs/* redirect pages into out/ after the export. The help moved
 * to docs.weaveforge.org, so each old /docs/ route forwards there. Run from
 * postbuild, after finish-export.mjs.
 */
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { redirectFiles } from "./lib/docs-redirects.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoDocs = path.resolve(here, "../../../docs");
const out = path.resolve(here, "../out");

const SECTIONS = ["using", "building", "running"];

const stemsOf = async (section) =>
  (await readdir(path.join(repoDocs, section)))
    .filter((name) => name.endsWith(".md"))
    .map((name) => name.slice(0, -3))
    .sort();

const using = await stemsOf("using");
const oldRels = [
  "",
  ...SECTIONS,
  ...using.map((stem) => `using/${stem}`),
  ...(await stemsOf("building")).map((stem) => `building/${stem}`),
  ...(await stemsOf("running")).map((stem) => `running/${stem}`),
];

const files = redirectFiles(oldRels, using);
for (const [rel, html] of files) {
  const target = path.join(out, rel);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, html);
}
console.log(`wrote ${files.size} docs redirect pages under ${path.relative(process.cwd(), path.join(out, "docs"))}`);
