import assert from "node:assert/strict";
import { test } from "node:test";

import { DOCS_ORIGIN, redirectFiles, redirectTarget } from "../scripts/lib/docs-redirects.mjs";

const STEMS = ["notes", "papers"];

test("an old /docs/using page goes to the same page on the docs site", () => {
  assert.equal(redirectTarget("using/notes", STEMS), "https://docs.weaveforge.org/notes.html");
});

test("an old page with no new equivalent goes to the docs home", () => {
  assert.equal(redirectTarget("building/architecture", STEMS), `${DOCS_ORIGIN}/`);
  assert.equal(redirectTarget("", STEMS), `${DOCS_ORIGIN}/`);
});

test("redirectFiles writes an index.html for /docs and each old page", () => {
  const files = redirectFiles(["", "using/notes", "using/gone", "building/architecture"], STEMS);
  assert.deepEqual([...files.keys()].sort(), [
    "docs/building/architecture/index.html",
    "docs/index.html",
    "docs/using/gone/index.html",
    "docs/using/notes/index.html",
  ]);
  assert.match(files.get("docs/using/notes/index.html"), /content="0; url=https:\/\/docs\.weaveforge\.org\/notes\.html"/);
  assert.match(files.get("docs/using/notes/index.html"), /location\.replace\("https:\/\/docs\.weaveforge\.org\/notes\.html"\)/);
  assert.match(files.get("docs/index.html"), /https:\/\/docs\.weaveforge\.org\//);
});
