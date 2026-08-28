/**
 * Copy the icons the exported site serves out of apps/web/public.
 *
 * Copied at build time rather than committed twice: a duplicated brand asset
 * is a duplicate that silently goes stale the first time the real one changes.
 */
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const from = path.resolve(here, "../../web/public/icons");
const to = path.resolve(here, "../public/icons");

await rm(to, { recursive: true, force: true });
await mkdir(path.dirname(to), { recursive: true });
await cp(from, to, { recursive: true });
console.log(`copied icons -> ${path.relative(process.cwd(), to)}`);

// The pdf.js worker, for the page that renders a real paper.
//
// Resolved from the package, not from apps/web/public. The web app copies it
// there in its own prebuild and the result is gitignored, so on a clean
// checkout — every CI run — that path does not exist and the build died at
// this line. The dependency is always installed; the copy in public is a
// build artefact of a different workspace.
const require = createRequire(import.meta.url);
const worker = "pdf.worker.min.mjs";
await cp(
  require.resolve("pdfjs-dist/build/pdf.worker.min.mjs"),
  path.resolve(here, "../public", worker),
);
console.log(`copied ${worker}`);

/**
 * The custom domain GitHub Pages serves this export from.
 *
 * `apps/pitch/public/` is gitignored — everything in it is copied in at build
 * time — so a hand-placed CNAME there is invisible to the repo and to review,
 * and it disappears on a clean checkout. Written here instead, where the host
 * the site answers on is a line of code like any other.
 */
const domain = process.env.PAGES_DOMAIN || "www.weaveforge.org";
await writeFile(path.resolve(here, "../public/CNAME"), `${domain}
`);
console.log(`wrote CNAME -> ${domain}`);

/**
 * The atlas, served as its own page.
 *
 * It is one designed HTML file generated from the repository, not Markdown, so
 * the docs renderer cannot show it — it is copied in and served at /atlas.html.
 * Copied rather than committed here for the same reason as the icons: a second
 * copy in the tree is a copy that goes stale.
 */
await cp(
  path.resolve(here, "../../../docs/atlas.html"),
  path.resolve(here, "../public/atlas.html"),
);
console.log("copied atlas.html");

/**
 * Mermaid, for the diagrams in the atlas.
 *
 * The atlas keeps its diagrams as `<pre class="mermaid">` source, which is the
 * right thing to store — a diagram in text stays reviewable in a diff, and the
 * page is generated from the repository. Something has to draw it, though, and
 * on the site nothing did: every map was a block of unrendered source, worst of
 * all on a phone. Served from our own origin rather than a CDN, so the page
 * draws with no third party involved and keeps working offline.
 */
await cp(
  require.resolve("mermaid/dist/mermaid.min.js"),
  path.resolve(here, "../public/mermaid.min.js"),
);
console.log("copied mermaid.min.js");
