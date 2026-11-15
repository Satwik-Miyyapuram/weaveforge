import assert from "node:assert/strict";
import { test } from "node:test";

import { coreModules, undocumentedModules, unlistedPages } from "../core-docs.mjs";

test("unlistedPages returns pages the README does not link", () => {
  const readme = "| [ai](ai.md) | Pure helpers. |\n";
  assert.deepEqual(unlistedPages(["ai.md", "bytea.md"], readme), ["bytea.md"]);
});

test("unlistedPages returns nothing when every page is linked", () => {
  assert.deepEqual(unlistedPages(["ai.md"], "[ai](ai.md)"), []);
});

test("unlistedPages does not count a longer name that ends in the page name", () => {
  assert.deepEqual(unlistedPages(["ai.md"], "[x](xai.md)"), ["ai.md"]);
});

test("coreModules takes directories and top-level .rs files under crates/wf-core/src", () => {
  const tracked = [
    "crates/wf-core/src/reader/anchor.rs",
    "crates/wf-core/src/reader/mod.rs",
    "crates/wf-core/src/bytea.rs",
    "crates/wf-core/src/ai/mod.rs",
    "crates/wf-core/src/lib.rs",
    "crates/wf-core/src/repos/showcase_data/papers.json",
    "crates/wf-core/Cargo.toml",
    "crates/wf-core/tests/smoke.rs",
    "apps/web/src/reader/x.ts",
  ];
  assert.deepEqual(coreModules(tracked), ["ai", "bytea", "reader", "repos"]);
});

test("coreModules returns sorted unique names", () => {
  const tracked = ["crates/wf-core/src/zeta.rs", "crates/wf-core/src/alpha/a.rs", "crates/wf-core/src/alpha/b.rs"];
  assert.deepEqual(coreModules(tracked), ["alpha", "zeta"]);
});

test("undocumentedModules reports modules no page mentions", () => {
  const text = "See `crates/wf-core/src/ai/` for prompts.";
  assert.deepEqual(undocumentedModules(["ai", "bytea"], text, []), ["bytea"]);
});

test("undocumentedModules accepts a path followed by .rs, a backtick or the end", () => {
  const text = "`crates/wf-core/src/a.rs` and `crates/wf-core/src/b` and crates/wf-core/src/c";
  assert.deepEqual(undocumentedModules(["a", "b", "c", "d"], text, []), ["d"]);
});

test("undocumentedModules does not count a longer module name as documented", () => {
  // Trap: `reader` must not match the text `crates/wf-core/src/reader_analysis`.
  const text = "Pure logic in `crates/wf-core/src/reader_analysis/outline.rs`.";
  assert.deepEqual(undocumentedModules(["reader", "reader_analysis"], text, []), ["reader"]);
});

test("undocumentedModules counts a module named in backticks, as the page tables do", () => {
  const text = "| `account_links` | x |\n`date_format.rs` and `ink/` and `latex::outline`";
  assert.deepEqual(undocumentedModules(["account_links", "date_format", "ink", "latex", "tree"], text, []), ["tree"]);
});

test("undocumentedModules does not count a backticked longer name or a bare word", () => {
  const text = "`text_anchor` and plain text and `tree_view`";
  assert.deepEqual(undocumentedModules(["text", "tree"], text, []), ["text", "tree"]);
});

test("undocumentedModules skips allowed modules", () => {
  assert.deepEqual(undocumentedModules(["ink", "bytea"], "", ["ink"]), ["bytea"]);
});
