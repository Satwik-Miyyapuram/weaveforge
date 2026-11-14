/**
 * Builds the database the docs' demo app opens: the shipped migrations plus the
 * app's own demo thesis, seeded by the same code as "Load the demo" in the app.
 *
 * Output (docs/.demo/, not committed): `db.tar.gz`, a PGlite data directory the
 * browser loads with `loadDataDir`, and `files.json`, the chart images the seed
 * stored as local files. Run by build-demo-app.mjs:
 *
 *   node --import tsx --import ./src/lib/test/preload-core.mts ../../scripts/user-docs/demo-db.mts
 *   (cwd apps/web, TSX_TSCONFIG_PATH=tsconfig.test.json)
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { LOCAL_BOOTSTRAP_SQL, LOCAL_USER_ID, applyMigrations } from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";
import { DEMO_PARSERS, localQuery } from "./demo-query.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "docs/.demo");

const db = await PGlite.create({ extensions: { pgcrypto }, parsers: DEMO_PARSERS });
await db.exec(LOCAL_BOOTSTRAP_SQL);
const migrations = ["db/migrations", "db/migrations-local"].flatMap((dir) =>
  readdirSync(path.join(ROOT, dir))
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name: `${path.basename(dir)}/${name}`, sql: readFileSync(path.join(ROOT, dir, name), "utf8") })),
);
await applyMigrations(migrations, (sql) => db.exec(sql));
// What the shell's ensure_local_user does on first open.
await db.query("insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing", [
  LOCAL_USER_ID,
  "local@weaveforge.invalid",
]);

const claims = readyCore().sessionClaims(LOCAL_USER_ID);
const files: Record<string, string> = {};
const key = (bucket: string, p: string) => `${bucket}/${p}`;
const bridge = {
  fetchTitle: async (url: string) => ({ title: url, url }),
  queryLocalDb: (sql: string, params: unknown[] = []) => localQuery(db, claims, sql, params),
  readLocalFile: async (bucket: string, p: string) => {
    const b64 = files[key(bucket, p)];
    return b64 ? new Uint8Array(Buffer.from(b64, "base64")) : null;
  },
  writeLocalFile: async (bucket: string, p: string, bytes: Uint8Array) => {
    files[key(bucket, p)] = Buffer.from(bytes).toString("base64");
  },
  removeLocalFile: async (bucket: string, p: string) => {
    delete files[key(bucket, p)];
  },
};
(globalThis as { window?: unknown }).window = { weaveforge: bridge };

// The seed fetches its charts from the app's public folder.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith("/showcase/")) {
    try {
      return new Response(readFileSync(path.join(ROOT, "apps/web/public", url)));
    } catch {
      return new Response(null, { status: 404 });
    }
  }
  return realFetch(input, init);
}) as typeof fetch;

const { loadLocalDemoWorkspace } = await import("@/features/showcase/application/load-local-demo");
const { projectId } = await loadLocalDemoWorkspace();

mkdirSync(OUT, { recursive: true });

// One PDF, so the reader has something to open: MAE (He et al., arXiv:2111.06377),
// licensed CC BY 4.0. Fetched once and kept in docs/.demo/, never committed.
const PDF_ARXIV = "2111.06377";
const pdfFile = path.join(OUT, "demo-paper.pdf");
if (!existsSync(pdfFile)) {
  const res = await realFetch(`https://arxiv.org/pdf/${PDF_ARXIV}`);
  if (!res.ok) throw new Error(`demo-db: arXiv answered ${res.status} for ${PDF_ARXIV}`);
  writeFileSync(pdfFile, Buffer.from(await res.arrayBuffer()));
}
const pdfRows = await localQuery(db, claims, "select id from public.papers where arxiv_id = $1 and project_id = $2", [PDF_ARXIV, projectId]);
const pdfPaperId = (pdfRows as { id: string }[])[0]?.id;
if (!pdfPaperId) throw new Error(`demo-db: no demo paper with arXiv id ${PDF_ARXIV}`);

const dump = await db.dumpDataDir("gzip");
writeFileSync(path.join(OUT, "db.tar.gz"), Buffer.from(await dump.arrayBuffer()));
writeFileSync(path.join(OUT, "files.json"), JSON.stringify({ projectId, pdfPaperId, claims, files }));
await db.close();
console.log(`demo-db: project ${projectId}, ${Object.keys(files).length} files -> docs/.demo/`);
