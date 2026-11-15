import assert from "node:assert/strict";
import { test } from "node:test";

import { codeRoots, extractRefs, missingAreaRows, missingFiles, missingIdents, missingPaths } from "../doc-refs.mjs";

test("extractRefs skips fenced code blocks", () => {
  const md = "Use `apps/web/src/a.ts` here.\n```sh\n`crates/wf-core/src/x.rs`\n```\n";
  assert.deepEqual(extractRefs(md).paths, [{ text: "apps/web/src/a.ts", line: 1 }]);
});

test("extractRefs skips generated blocks", () => {
  const md = "<!-- generated:ipc -->\n`apps/gone.ts`\n<!-- /generated:ipc -->\n`apps/web` and `db_query`\n";
  const { paths, idents } = extractRefs(md);
  assert.deepEqual(paths, [{ text: "apps/web", line: 4 }]);
  assert.deepEqual(idents, [{ text: "db_query", line: 4 }]);
});

test("extractRefs strips a line suffix and a trailing slash", () => {
  const { paths } = extractRefs("`crates/wf-core/src/lib.rs:123` `docs/a.md:12-34` `db/migrations/`");
  assert.deepEqual(
    paths.map((p) => p.text),
    ["crates/wf-core/src/lib.rs", "docs/a.md", "db/migrations"],
  );
});

test("extractRefs leaves out tokens with spaces, globs and placeholders", () => {
  assert.deepEqual(extractRefs("`apps/web/x y` `crates/*` `packages/<name>` `db/{a,b}` `apps/web/.../x.ts`").paths, []);
});

test("extractRefs keeps snake and camel names and drops plain words", () => {
  const { idents } = extractRefs("`paperToRow` `ab_c` `plain` `ab`");
  assert.deepEqual(
    idents.map((i) => i.text),
    ["paperToRow", "ab_c"],
  );
});

test("extractRefs takes the last segment of a::b", () => {
  assert.deepEqual(extractRefs("`wf_core::paper::paper_to_row`").idents, [{ text: "paper_to_row", line: 1 }]);
});

const tracked = new Set(["apps/web/src/a.ts", "docs/x.md"]);

test("missingPaths counts a tracked file or a directory above one as present", () => {
  const paths = [
    { text: "apps/web", line: 1 },
    { text: "apps/web/src/a.ts", line: 2 },
    { text: "apps/web/gone.ts", line: 3 },
  ];
  assert.deepEqual(missingPaths(paths, tracked, []), [{ text: "apps/web/gone.ts", line: 3 }]);
});

test("missingPaths lets an allowlisted prefix through", () => {
  const paths = [
    { text: "packages/wf-wasm/pkg/index.js", line: 1 },
    { text: "crates/wf-store/target/debug/x", line: 2 },
    { text: "apps/web/.env.local", line: 3 },
  ];
  assert.deepEqual(missingPaths(paths, tracked, ["packages/wf-wasm/pkg", "target/", "apps/web/.env.local"]), []);
});

test("missingIdents accepts the snake or camel form of a word in source", () => {
  const words = new Set(["paperToRow", "db_query"]);
  const idents = [
    { text: "paper_to_row", line: 1 },
    { text: "dbQuery", line: 2 },
    { text: "redact_report", line: 3 },
  ];
  assert.deepEqual(missingIdents(idents, words, []), [{ text: "redact_report", line: 3 }]);
});

test("missingIdents checks the last segment of a::b", () => {
  const { idents } = extractRefs("`wf::paper_to_row`");
  assert.deepEqual(missingIdents(idents, new Set(["paper_to_row"]), []), []);
});

test("missingIdents lets allowlisted names through", () => {
  assert.deepEqual(missingIdents([{ text: "versionCode", line: 1 }], new Set(), ["versionCode"]), []);
});

test("missingAreaRows reports a code root with no AREAS row", () => {
  assert.deepEqual(missingAreaRows(["crates/wf-core", "crates/wf-new"], ["crates/wf-core"]), ["crates/wf-new"]);
});

test("missingAreaRows passes a root that has a row", () => {
  assert.deepEqual(missingAreaRows(["apps/web"], ["apps/web", "docs"]), []);
});

test("codeRoots lists each crates, apps or packages root with a tracked file, nested or not", () => {
  const tracked = ["apps/web/src/a.ts", "crates/wf-core/src/lib.rs", "packages/wf/index.ts", "packages/wf/src/deep/b.ts"];
  assert.deepEqual(codeRoots(tracked), ["apps/web", "crates/wf-core", "packages/wf"]);
});

test("codeRoots counts each root once and ignores non-root paths", () => {
  const tracked = ["apps/web/a.ts", "apps/web/b.ts", "apps/web/c.ts", "docs/x.md", "scripts/a.mjs", "crates/README.md", "apps/x.ts"];
  assert.deepEqual(codeRoots(tracked), ["apps/web"]);
});

test("codeRoots returns sorted roots and ignores a bare crates, apps or packages segment", () => {
  assert.deepEqual(codeRoots(["packages/b/x.ts", "crates/a/x.rs", "apps", "crates"]), ["crates/a", "packages/b"]);
});

test("extractRefs collects a bare file name with a code extension", () => {
  const { paths, files } = extractRefs("`write-back-zotero-annotations.ts` and `mcp-connect.ts`");
  assert.deepEqual(paths, []);
  assert.deepEqual(files, [
    { text: "write-back-zotero-annotations.ts", line: 1 },
    { text: "mcp-connect.ts", line: 1 },
  ]);
});

test("extractRefs skips globs, generic placeholders and non-code extensions", () => {
  assert.deepEqual(extractRefs("`reader_analysis_*.rs` `<module>.md` `<name>.css` `{a,b}.ts` `notes.txt` `.env.local`").files, []);
});

test("extractRefs strips a line suffix and a leading ./ from a bare file name", () => {
  const { files } = extractRefs("`foo.rs:546` `./bindings.ts`");
  assert.deepEqual(
    files.map((f) => f.text),
    ["foo.rs", "bindings.ts"],
  );
});

test("extractRefs keeps a dotted package config name", () => {
  assert.deepEqual(extractRefs("`next.config.mjs`").files, [{ text: "next.config.mjs", line: 1 }]);
});

const trackedFiles = new Set(["apps/web/src/a.ts", "packages/wf/next.config.mjs", "docs/x.md"]);

test("missingFiles passes a bare name whose basename is tracked anywhere", () => {
  const files = [
    { text: "a.ts", line: 1 },
    { text: "next.config.mjs", line: 2 },
    { text: "gone.ts", line: 3 },
  ];
  assert.deepEqual(missingFiles(files, trackedFiles, []), [{ text: "gone.ts", line: 3 }]);
});

test("missingFiles lets an allowlisted bare name through", () => {
  assert.deepEqual(missingFiles([{ text: "gone.ts", line: 1 }], trackedFiles, ["gone.ts"]), []);
});
