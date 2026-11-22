/**
 * Builds the workspace the docs' demo app opens: the showcase thesis written
 * through the app's file repositories (seed-showcase-files.ts) into an in-memory
 * folder, then dumped to docs/.demo/. No database is involved.
 *
 * Output (docs/.demo/, not committed):
 *   - `workspace.json`: { projectId, pdfPaperId, files }. A text file is `{ text }`;
 *     a binary file (chart PNG) is `{ file }`, a path under docs/.demo/.
 *   - `assets/*.png`: copies of the chart images, served to the demo.
 *   - `demo-paper.pdf`: the paper the reader opens (MAE, arXiv:2111.06377, CC BY 4.0),
 *     fetched once and never committed.
 * Run by build-demo-app.mjs:
 *
 *   node --import tsx --import ./src/lib/test/preload-core.mts ../../scripts/user-docs/demo-workspace.mts
 *   (cwd apps/web, TSX_TSCONFIG_PATH=tsconfig.test.json)
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";
import { MemorySettings } from "@/backend/providers/files/test/memory-settings";
import { seedShowcaseFiles, SHOWCASE_PDF_ARXIV_ID } from "../../apps/web/src/features/showcase/infrastructure/seed-showcase-files";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WEB = path.join(ROOT, "apps/web");
const OUT = path.join(ROOT, "docs/.demo");
const BINARY = /\.(png|jpe?g|webp|gif|pdf)$/i;
// The seed never touches secrets; the demo has no account, so nothing is stored.
const NO_SECRETS = { load: async () => ({}), save: async () => {} } as never;

const fs = new MemoryWorkspaceFs();
const { projectId, pdfPaperId } = await seedShowcaseFiles({
  fs,
  settings: new MemorySettings(),
  secrets: NO_SECRETS,
  readChart: async (file) => {
    const source = path.join(WEB, "public/showcase", file);
    return existsSync(source) ? new Uint8Array(readFileSync(source)) : null;
  },
});
if (!pdfPaperId) throw new Error(`demo-workspace: no demo paper with arXiv id ${SHOWCASE_PDF_ARXIV_ID}`);

mkdirSync(OUT, { recursive: true });
// Outputs of the retired PGlite build; the reuse check below no longer reads them.
for (const old of ["db.tar.gz", "files.json"]) rmSync(path.join(OUT, old), { force: true });

const files: Record<string, { text: string } | { file: string }> = {};
for await (const entry of fs.walk("")) {
  if (entry.kind !== "file") continue;
  const bytes = await fs.readFile(entry.path);
  if (BINARY.test(entry.path)) {
    const copy = path.join(OUT, entry.path);
    mkdirSync(path.dirname(copy), { recursive: true });
    writeFileSync(copy, bytes);
    files[entry.path] = { file: entry.path };
  } else {
    files[entry.path] = { text: new TextDecoder().decode(bytes) };
  }
}

const pdfFile = path.join(OUT, "demo-paper.pdf");
if (!existsSync(pdfFile)) {
  const res = await fetch(`https://arxiv.org/pdf/${SHOWCASE_PDF_ARXIV_ID}`);
  if (!res.ok) throw new Error(`demo-workspace: arXiv answered ${res.status} for ${SHOWCASE_PDF_ARXIV_ID}`);
  writeFileSync(pdfFile, Buffer.from(await res.arrayBuffer()));
}

writeFileSync(path.join(OUT, "workspace.json"), JSON.stringify({ projectId, pdfPaperId, files }));
console.log(`demo-workspace: project ${projectId}, ${Object.keys(files).length} files -> docs/.demo/`);
