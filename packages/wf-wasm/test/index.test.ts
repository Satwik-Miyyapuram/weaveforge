import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import {
  applyCommaPlacement,
  buildExcerpt,
  changedSide,
  cleanPastedText,
  cleanPdfText,
  cleanUrlsWithRules,
  cleanWrappedText,
  coreInfo,
  decideGitSyncPath,
  defaultInkNoteMeta,
  defaultPasteSettings,
  describePull,
  describePush,
  diffBody,
  entityDir,
  decideVaultCommit,
  describeChanges,
  extractDoi,
  extractPageMetadata,
  redactSecret,
  fuseRankings,
  GIT_SYNC_MAX_FILE_BYTES,
  guessBlobContentType,
  hasConflictMarkers,
  imageAltFromFilename,
  indexTerms,
  initSync,
  isInkNoteBody,
  isSafeWorkspacePath,
  isUnderIgnoredFolder,
  jsonKindOfPath,
  maxFusionIds,
  maxIndexTextUtf16,
  mergeHunks,
  mergeRows,
  mergeVaultPage,
  normalizeArxivId,
  normalizePasteSettings,
  pageImportRefusal,
  parseLinkRemovalText,
  parsePaperRef,
  parseQuery,
  pasteLandsInVerbatimContext,
  readFrontmatter,
  readInkNoteBody,
  safeWorkspacePath,
  sameValue,
  stampWorkspaceId,
  tabSeparatedToMarkdownTable,
  tokenize,
  vaultPageBase,
  vaultPageSide,
  writeConflictMarkers,
  writeFrontmatter,
  writeInkNoteBody,
  type InkNoteMeta,
  type ParsedQuery,
  type TokenizerOptions,
} from "../src/index.js";
import { buildExcerpt as rawBuildExcerpt, fuseRankings as rawFuseRankings } from "../pkg/wf_wasm.js";
import { parsePaperFieldValue } from "../src/papers-field-value.js";
import { computeRollupsForPapers } from "../src/papers-compute-rollup.js";
import {
  findDuplicateGroups,
  isConferenceCopy,
  pickKeeper,
  titleFixes,
  type TidyPaper,
} from "../src/papers-library-tidy.js";

const pkgDir = new URL("../pkg/", import.meta.url);
initSync({ module: readFileSync(new URL("wf_wasm_bg.wasm", pkgDir)) });

const read = (url: URL) => readFileSync(url, "utf8");
/** index.ts and every sibling wrapper module; bindings.ts is generated. */
const wrapperSources = () => {
  const src = new URL("../src/", import.meta.url);
  return readdirSync(src)
    .filter((name) => name.endsWith(".ts") && name !== "bindings.ts")
    .map((name) => read(new URL(name, src)))
    .join("\n");
};

test("coreInfo returns the core crate version", () => {
  const cargo = read(new URL("../../../Cargo.toml", import.meta.url));
  const version = cargo.match(/^version = "([^"]+)"/m)?.[1];
  assert.ok(version, "Cargo.toml has no workspace version");
  assert.deepEqual(coreInfo(), { version });
});

test("the wrapper modules declare no types of their own", () => {
  // Every type comes from bindings.ts, which wf-bindings generates from Rust,
  // so a type cannot drift from its Rust struct.
  const src = wrapperSources();
  assert.doesNotMatch(src, /^\s*(export\s+)?(type|interface)\s+\w+/m);
});

test("every raw wasm export has a typed wrapper", () => {
  // A raw export returns `any`; the wrapper is where it gets its generated type.
  const dts = read(new URL("wf_wasm.d.ts", pkgDir));
  const names = [...dts.matchAll(/^export function (\w+)\(/gm)].map((m) => m[1]).filter((n) => n !== "initSync");
  assert.ok(names.length > 0, "found no raw exports in wf_wasm.d.ts");
  const src = wrapperSources();
  for (const name of names) {
    assert.match(src, new RegExp(`^export function ${name}(<[^>]*>)?\\(`, "m"), `no typed wrapper for ${name}`);
  }
});

test("wf-wasm exports no classes or enums", () => {
  // A #[wasm_bindgen] struct or enum would bypass the wrapper and bindings.ts.
  // Agree how to type them before adding one.
  const dts = read(new URL("wf_wasm.d.ts", pkgDir));
  assert.doesNotMatch(dts, /^export (declare )?(class|enum) /m);
});

const ALL_ON: TokenizerOptions = {
  foldDiacritics: true,
  foldArabicDiacritics: true,
  splitCamelCase: true,
  tokenizeUrls: true,
};

test("tokenize returns deduplicated lowercase terms", () => {
  assert.deepEqual(tokenize("Hello, World! hello", ALL_ON), ["hello", "world"]);
  assert.deepEqual(tokenize("", ALL_ON), []);
});

test("indexTerms folds each token and keeps duplicates", () => {
  const terms = indexTerms("café myVariable", ALL_ON);
  assert.ok(Array.isArray(terms));
  assert.ok(terms.every((t) => typeof t === "string"));
  assert.deepEqual(terms, ["cafe", "my", "variable", "myvariable"]);
});

test("maxIndexTextUtf16 is the Rust cap", () => {
  assert.equal(maxIndexTextUtf16(), 2 ** 24);
});

test("tokenize and indexTerms reject text over MAX_INDEX_TEXT_UTF16 before WASM", () => {
  // A RangeError comes from the wrapper; the Rust check throws a plain Error.
  // So the text was never copied into linear memory.
  const huge = "a".repeat(2 ** 24 + 1);
  const beforeWasm = (e: unknown) => e instanceof RangeError && /MAX_INDEX_TEXT_UTF16/.test(e.message);
  assert.throws(() => tokenize(huge, ALL_ON), beforeWasm);
  assert.throws(() => indexTerms(huge, ALL_ON), beforeWasm);
});

test("tokenize accepts text at exactly MAX_INDEX_TEXT_UTF16", () => {
  // Multi-byte chars: 2**24 UTF-16 units but 3 * 2**24 UTF-8 bytes, past the fast path.
  assert.equal(tokenize("é".repeat(2 ** 24), ALL_ON).length, 1);
});

test("tokenize rejects malformed options", () => {
  // Extra keys are not rejected: serde-wasm-bindgen reads only the struct's
  // own fields, so deny_unknown_fields never fires. TokenizerOptions is exact in TS.
  const bad = (o: unknown) => () => tokenize("x", o as TokenizerOptions);
  assert.throws(bad({ foldDiacritics: true }), /missing field/);
  assert.throws(bad({ ...ALL_ON, tokenizeUrls: "yes" }));
  assert.throws(bad(undefined));
});

test("parseQuery returns every field, modifiedWithinDays included", () => {
  const q: ParsedQuery = parseQuery('kind:note type:PDF "Deep Dive" -old path:Method in:x tag:#vae modified:2w modified:3d Latent');
  assert.deepEqual(q, {
    terms: ["latent"],
    phrases: ["deep dive"],
    exclude: ["old"],
    kinds: ["note", "pdf"],
    paths: ["method", "x"],
    tags: ["vae"],
    modifiedWithinDays: 3,
    text: "deep dive latent",
  });
});

test("parseQuery gives null, not a missing key, when there is no modified filter", () => {
  const q = parseQuery("");
  assert.ok("modifiedWithinDays" in q);
  assert.equal(q.modifiedWithinDays, null);
  assert.deepEqual(q, { terms: [], phrases: [], exclude: [], kinds: [], paths: [], tags: [], modifiedWithinDays: null, text: "" });
});

test("parseQuery rejects a query over MAX_INDEX_TEXT_UTF16 before WASM", () => {
  const huge = "a".repeat(2 ** 24 + 1);
  assert.throws(() => parseQuery(huge), (e: unknown) => e instanceof RangeError && /MAX_INDEX_TEXT_UTF16/.test(e.message));
});

const self = (id: string) => id;

test("maxFusionIds is 2^20", () => {
  assert.equal(maxFusionIds(), 2 ** 20);
});

test("fuseRankings ranks an id both lists like above one only one list has", () => {
  // a: 1/61 + 1/62, c: 1/63 + 1/61, b: 1/62.
  assert.deepEqual(fuseRankings([{ items: ["a", "b", "c"] }, { items: ["c", "a"] }], self), ["a", "c", "b"]);
  assert.deepEqual(fuseRankings([], self), []);
  assert.deepEqual(fuseRankings([{ items: [] }], self), []);
});

test("fuseRankings returns the item from the first list an id appears in", () => {
  const keyword = [{ id: "x", from: "keyword" }, { id: "y", from: "keyword" }];
  const vector = [{ id: "y", from: "vector" }, { id: "z", from: "vector" }];
  const fused = fuseRankings([{ items: keyword }, { items: vector }], (item) => item.id);
  assert.deepEqual(fused, [
    { id: "y", from: "keyword" },
    { id: "x", from: "keyword" },
    { id: "z", from: "vector" },
  ]);
  assert.equal(fused[0], keyword[1]);
});

test("fuseRankings applies weights, k and limit", () => {
  assert.deepEqual(fuseRankings([{ items: ["x", "y"], weight: 0 }, { items: ["y", "x"] }], self), ["y", "x"]);
  assert.deepEqual(fuseRankings([{ items: ["x", "y"], weight: 2 }, { items: ["y", "x"] }], self), ["x", "y"]);
  // b gets 1/(k+2) + 1/(k+3): below a's 1/(k+1) at k = 0, above it at the default 60.
  const twoArms = [{ items: ["a", "b"] }, { items: ["c", "d", "b"] }];
  assert.deepEqual(fuseRankings(twoArms, self, { k: 0 }), ["a", "c", "b", "d"]);
  assert.deepEqual(fuseRankings(twoArms, self), ["b", "a", "c", "d"]);
  const list = [{ items: ["a", "b", "c"] }];
  assert.deepEqual(fuseRankings(list, self, { limit: 2 }), ["a", "b"]);
  assert.deepEqual(fuseRankings(list, self, { limit: 0 }), ["a", "b", "c"]);
  assert.deepEqual(fuseRankings(list, self, { limit: 0xffff_ffff }), ["a", "b", "c"]);
});

test("fuseRankings counts every occurrence of a repeated id", () => {
  // a: 1/61 + 1/63, b: 1/62.
  assert.deepEqual(fuseRankings([{ items: ["a", "b", "a"] }], self), ["a", "b"]);
});

test("fuseRankings breaks ties on code point order, not localeCompare", () => {
  // localeCompare puts "a" before "Z"; code point order puts "Z" (U+005A) first.
  assert.deepEqual(fuseRankings([{ items: ["a"] }, { items: ["Z"] }], self), ["Z", "a"]);
});

test("fuseRankings rejects a bad k or limit before WASM", () => {
  for (const bad of [-1, 1.5, Number.NaN, 2 ** 32, Number.POSITIVE_INFINITY]) {
    assert.throws(() => fuseRankings([{ items: ["a"] }], self, { k: bad }), (e: unknown) => e instanceof RangeError && /^k /.test(e.message));
    assert.throws(() => fuseRankings([{ items: ["a"] }], self, { limit: bad }), (e: unknown) => e instanceof RangeError && /^limit /.test(e.message));
  }
});

test("fuseRankings rejects a weight that is negative or not finite", () => {
  for (const weight of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => fuseRankings([{ items: ["a"] }, { items: ["b"], weight }], self), /list 1 weight/);
  }
});

test("fuseRankings rejects more than MAX_FUSION_IDS ids in total before identify runs", () => {
  // Each list is under the cap; together they are one over it.
  let calls = 0;
  const half = () => ({ items: new Array<string>(2 ** 19).fill("a") });
  const count = (id: string) => {
    calls += 1;
    return id;
  };
  const over = [half(), { items: ["b"] }, half()];
  assert.throws(() => fuseRankings(over, count), (e: unknown) => e instanceof RangeError && /lists have 1048577 ids in total; MAX_FUSION_IDS is 1048576/.test(e.message));
  assert.equal(calls, 0);
  assert.equal(fuseRankings([half(), half()], self).length, 1);
});

test("fuseRankings raw export rejects more than MAX_FUSION_IDS ids in total", () => {
  const ids = new Array<string>(2 ** 19 + 1).fill("a");
  assert.throws(() => rawFuseRankings([{ ids, weight: 1 }, { ids, weight: 1 }]), /lists have 1048578 ids in total; MAX_FUSION_IDS is 1048576/);
});

test("index.ts does not re-export RankedList", () => {
  // Its generated weight is `number | null`, but Rust rejects null; the wrapper's {items, weight?} is the public shape.
  const src = read(new URL("../src/index.ts", import.meta.url));
  assert.doesNotMatch(src, /export type \{[^}]*RankedList/);
});

test("buildExcerpt highlights each term in a short body", () => {
  assert.deepEqual(buildExcerpt("Graph neural networks", ["GRAPH", "Networks"]), {
    text: "Graph neural networks",
    highlights: [
      { start: 0, end: 5 },
      { start: 13, end: 21 },
    ],
  });
  assert.deepEqual(buildExcerpt("", ["x"]), { text: "", highlights: [] });
});

test("buildExcerpt keeps newlines only with singleLine false", () => {
  const body = "line one\n\nline two";
  assert.equal(buildExcerpt(body, ["two"]).text, "line one line two");
  assert.equal(buildExcerpt(body, ["two"], { singleLine: false }).text, body);
});

test("buildExcerpt keeps a split surrogate half instead of U+FFFD", () => {
  // The 40-unit window cuts through the emoji run, so one edge splits a pair.
  const emoji = "\u{1f600}".repeat(30);
  const { text, highlights } = buildExcerpt(`${emoji}hit${emoji}`, ["hit"], { maxChars: 40 });
  assert.ok(!text.includes("�"));
  // A lone surrogate survives (split emoji at the cut), like the TS original.
  assert.match(text, /\p{Cs}/u);
  assert.equal(highlights.length, 1);
  assert.equal(text.slice(highlights[0]!.start, highlights[0]!.end), "hit");
});

test("buildExcerpt decodes a text longer than one 8192-unit chunk", () => {
  const { text, highlights } = buildExcerpt("word ".repeat(20_000), ["word"], { maxChars: 50_000 });
  assert.ok(text.length > 3 * 8192);
  assert.ok(highlights.length > 1000);
  for (const h of highlights) assert.equal(text.slice(h.start, h.end), "word");
});

test("buildExcerpt rejects a body over MAX_INDEX_TEXT_UTF16 before WASM", () => {
  const huge = "a".repeat(2 ** 24 + 1);
  assert.throws(() => buildExcerpt(huge, ["a"]), (e: unknown) => e instanceof RangeError && /MAX_INDEX_TEXT_UTF16/.test(e.message));
});

test("buildExcerpt rejects terms over MAX_INDEX_TEXT_UTF16 in total before WASM", () => {
  // Each term counts its length + 1, so a flood of empty terms is capped too.
  // Two of these fill the cap exactly; one more empty term is over it.
  const half = "a".repeat(2 ** 23 - 1);
  const message = /^terms need 16777217 UTF-16 units \(length \+ 1 each\); MAX_INDEX_TEXT_UTF16 is 16777216$/;
  assert.throws(() => buildExcerpt("x", [half, half, ""]), (e: unknown) => e instanceof RangeError && message.test(e.message));
  assert.equal(buildExcerpt("x", [half, half]).text, "x");
});

test("buildExcerpt raw export rejects terms over MAX_INDEX_TEXT_UTF16 in total", () => {
  const half = "a".repeat(2 ** 23 - 1);
  assert.throws(() => rawBuildExcerpt("x", [half, half, ""]), /terms need 16777217 UTF-16 units \(length \+ 1 each\); MAX_INDEX_TEXT_UTF16 is 16777216/);
  assert.throws(() => rawBuildExcerpt("x", "not an array"));
});

test("buildExcerpt rejects a bad maxChars before WASM", () => {
  for (const bad of [-1, 1.5, Number.NaN, 2 ** 32, Number.POSITIVE_INFINITY]) {
    assert.throws(() => buildExcerpt("x", ["x"], { maxChars: bad }), (e: unknown) => e instanceof RangeError && /^maxChars /.test(e.message));
  }
  assert.equal(buildExcerpt("x", ["x"], { maxChars: 0xffff_ffff }).text, "x");
});

test("changedSide reports which side moved since the base", () => {
  assert.equal(changedSide({}), "unknown");
  assert.equal(changedSide({ base: "x", folder: "x", workspace: "x" }), "neither");
  assert.equal(changedSide({ base: "a", folder: "b", workspace: "a" }), "folder");
  assert.equal(changedSide({ base: "a", folder: "a", workspace: "c" }), "workspace");
  assert.equal(changedSide({ base: "a", folder: "b", workspace: "c" }), "both");
});

test("isUnderIgnoredFolder matches folders git sync never touches", () => {
  assert.equal(isUnderIgnoredFolder("node_modules/x.js"), true);
  assert.equal(isUnderIgnoredFolder("notes/a.md"), false);
});

test("decideGitSyncPath includes normal files and names the skip reason", () => {
  assert.deepEqual(decideGitSyncPath("notes/a.md", 10), { include: true });
  assert.deepEqual(decideGitSyncPath("a.aux", 1), { include: false, reason: "ignored-file" });
  assert.deepEqual(decideGitSyncPath("a.md", GIT_SYNC_MAX_FILE_BYTES + 1), { include: false, reason: "too-large" });
  assert.deepEqual(decideGitSyncPath("", 1), { include: false, reason: "invalid-path" });
  assert.deepEqual(decideGitSyncPath("a.md", Number.NaN), { include: false, reason: "too-large" });
});

test("decideVaultCommit gives the Rust verdict for each repo state", () => {
  assert.deepEqual(decideVaultCommit(false, { kind: "own" }), { ok: false, reason: "Folder history is switched off." });
  assert.deepEqual(decideVaultCommit(true, { kind: "own" }), { ok: true, action: "commit" });
  assert.deepEqual(decideVaultCommit(true, { kind: "none" }), { ok: true, action: "init" });
  const enclosed = decideVaultCommit(true, { kind: "enclosing", root: "/home/me/thesis" });
  assert.equal(enclosed.ok, false);
  assert.match(enclosed.ok ? "" : enclosed.reason, /\/home\/me\/thesis/);
});

test("redactSecret replaces every occurrence of the token and ignores an empty secret", () => {
  assert.equal(redactSecret("auth abc failed for abc", "abc"), "auth *** failed for ***");
  assert.equal(redactSecret("nothing here", undefined), "nothing here");
  assert.equal(redactSecret("nothing here", ""), "nothing here");
});

test("describeChanges counts each state in a fixed order", () => {
  assert.equal(describeChanges([]), "No changes");
  assert.equal(
    describeChanges([
      { state: "added" },
      { state: "modified" },
      { state: "modified" },
      { state: "deleted" },
    ]),
    "1 added, 2 changed, 1 removed",
  );
});

test("describePull and describePush give one settings line", () => {
  assert.equal(describePull({ kind: "up-to-date" }), "Already up to date.");
  assert.ok(describePull({ kind: "conflict", files: ["a.md"] }).includes("1 file changed"));
  assert.equal(describePush({ kind: "rejected", reason: "r" }), "Not pushed: r");
  assert.throws(() => describePull({ kind: "bogus" } as never));
});

test("stampWorkspaceId adds the id only when the file has none", () => {
  assert.equal(stampWorkspaceId("---\nweaveforge-id: a\n---\nx", "b"), null);
  assert.ok(stampWorkspaceId("hello", "id1")?.includes("weaveforge-id: id1"));
});

test("safeWorkspacePath normalizes and refuses escapes from the root", () => {
  assert.equal(safeWorkspacePath("./a\\b//c.md"), "a/b/c.md");
  assert.throws(() => safeWorkspacePath("../x"), /Unsafe workspace path: \.\.\/x/);
  assert.equal(isSafeWorkspacePath("/etc"), false);
  assert.equal(isSafeWorkspacePath("a/b"), true);
});

test("parsePaperRef normalizes each kind", () => {
  assert.deepEqual(parsePaperRef("doi", "https://arxiv.org/abs/2305.12345v2"), { kind: "arxiv", value: "2305.12345" });
  assert.deepEqual(parsePaperRef("zotero", "  ABCD1234 "), { kind: "zotero", value: "ABCD1234" });
  assert.deepEqual(parsePaperRef("url", "example.com/paper"), { kind: "url", value: "https://example.com/paper" });
  assert.throws(() => parsePaperRef("bibliographic" as never, "x"));
});

test("normalizeArxivId strips prefixes and rejects non-ids", () => {
  assert.equal(normalizeArxivId(undefined), undefined);
  assert.equal(normalizeArxivId("arXiv:2305.12345v1"), "2305.12345");
  assert.equal(normalizeArxivId("not an id"), undefined);
});

test("extractDoi finds a DOI in a URL", () => {
  assert.equal(extractDoi("https://doi.org/10.1145/3290605.3300233)."), "10.1145/3290605.3300233");
  assert.equal(extractDoi(""), undefined);
});

test("extractPageMetadata reads citation meta tags", () => {
  const html = '<html><head><meta name="citation_title" content="A Paper"><meta name="citation_author" content="Ada Lovelace"></head></html>';
  const result = extractPageMetadata(html, "https://example.org/p");
  assert.equal(result.title, "A Paper");
  assert.deepEqual(result.authors, ["Ada Lovelace"]);
  assert.equal(result.url, "https://example.org/p");
  assert.equal(typeof result.hasCitationMeta, "boolean");
  assert.equal(typeof result.isArticle, "boolean");
  // Absent optional fields are omitted, not null.
  assert.equal("doi" in result, false);
});

test("pageImportRefusal accepts a page with metadata and refuses a bare one", () => {
  const result = extractPageMetadata('<html><head><meta name="citation_title" content="A Paper"><meta name="citation_author" content="Ada Lovelace"></head></html>', "https://example.org/p");
  assert.equal(pageImportRefusal(result), null);
  const bare = { authors: [], url: "https://x.org", hasCitationMeta: false, isArticle: false };
  const refusal = pageImportRefusal(bare);
  assert.ok(typeof refusal === "string" && refusal.length > 0);
});

test("guessBlobContentType maps known extensions and falls back", () => {
  assert.equal(guessBlobContentType("a/b.pdf"), "application/pdf");
  const fallback = guessBlobContentType("x.unknownext");
  assert.ok(typeof fallback === "string" && fallback.length > 0);
});

test("extractDoi rejects text over MAX_INDEX_TEXT_UTF16 before WASM", () => {
  assert.throws(() => extractDoi("x".repeat(maxIndexTextUtf16() + 1)), RangeError);
});

const NOTE_PATH = "notes/t--111111.note.md";
const note = (status: string, body: string) =>
  `---\nweaveforge-id: 11111111-1111-4111-8111-111111111111\nweaveforge-type: vault_page\ntitle: T\nstatus: ${status}\n---\n${body}`;

test("mergeVaultPage takes a field only one side moved", () => {
  const base = { fields: { title: "T", status: "a" }, bodyDigest: vaultPageBase(NOTE_PATH, note("a", "body\n"))!.bodyDigest };
  const folder = { fields: { title: "T", status: "b" }, body: "body\n" };
  const workspace = { fields: { title: "T", status: "a" }, body: "body\n" };
  const result = mergeVaultPage(base, folder, workspace);
  assert.equal(result.fields.status, "b");
  assert.deepEqual(result.conflicts, []);
});

test("mergeVaultPage reports a field both sides moved", () => {
  const base = { fields: { title: "T", status: "a" }, bodyDigest: vaultPageBase(NOTE_PATH, note("a", "body\n"))!.bodyDigest };
  const folder = { fields: { title: "T", status: "b" }, body: "body\n" };
  const workspace = { fields: { title: "T", status: "c" }, body: "body\n" };
  const result = mergeVaultPage(base, folder, workspace);
  assert.deepEqual(result.conflicts, [{ field: "status", base: "a", local: "b", remote: "c" }]);
  assert.equal(result.fields.status, "c");
});

test("vaultPageBase and vaultPageSide read a note, null for a file that is not one", () => {
  const side = vaultPageSide(NOTE_PATH, note("a", "hello\n"));
  assert.equal(side?.body, "hello\n");
  assert.equal(side?.fields.title, "T");
  assert.equal(side?.fields.status, "a");
  const base = vaultPageBase(NOTE_PATH, note("a", "hello\n"));
  assert.match(base?.bodyDigest ?? "", /^[0-9a-f]{16}$/);
  assert.equal(vaultPageBase("notes/x.txt", "plain text"), null);
  assert.equal(vaultPageSide("notes/x.txt", "plain text"), null);
});

test("mergeHunks follows the picks, keyed by hunk index", () => {
  assert.equal(mergeHunks("a\nb\nc", "a\nB\nc", {}), "a\nb\nc");
  assert.equal(mergeHunks("a\nb\nc", "a\nB\nc", { 0: "theirs" }), "a\nB\nc");
  const both = mergeHunks("a\nb\nc", "a\nB\nc", { 0: "both" });
  const lines = both.split("\n");
  assert.ok(lines.includes("b") && lines.includes("B"));
  assert.equal(mergeHunks("a\nb\nc", "a\nB\nc", { "00": "theirs" } as never), "a\nb\nc");
});

test("writeConflictMarkers marks the differing lines", () => {
  const result = writeConflictMarkers("a\nb", "a\nc");
  assert.ok(result.includes("<<<<<<< this app"));
  assert.ok(result.includes("======="));
  assert.ok(result.includes(">>>>>>> the folder"));
});

test("readFrontmatter and writeFrontmatter round-trip", () => {
  const text = writeFrontmatter({ title: "T", tags: ["x", "y"], n: 2, skip: undefined, empty: [] }, "body\n");
  const order = ["title", "tags", "n"].map((key) => text.search(new RegExp(`^${key}:`, "m")));
  assert.ok(order.every((at) => at >= 0));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  const parsed = readFrontmatter(text);
  assert.deepEqual(parsed.frontmatter, { title: "T", tags: ["x", "y"], n: 2 });
  assert.equal(parsed.body, "body\n");
});

test("the merge wrappers reject text over MAX_INDEX_TEXT_UTF16 before WASM", () => {
  const huge = "a".repeat(2 ** 24 + 1);
  const beforeWasm = (e: unknown) => e instanceof RangeError && /MAX_INDEX_TEXT_UTF16/.test(e.message);
  assert.throws(() => writeConflictMarkers(huge, ""), beforeWasm);
  assert.throws(() => readFrontmatter(huge), beforeWasm);
  assert.throws(() => vaultPageSide("a.md", huge), beforeWasm);
});

test("mergeRows merges per field and reports conflicts", () => {
  assert.deepEqual(mergeRows({ title: "a", n: 1 }, { title: "b", n: 1 }, { title: "a", n: 2 }), {
    merged: { title: "b", n: 2 },
    conflicts: [],
  });
  assert.deepEqual(mergeRows({ t: "a" }, { t: "b" }, { t: "c" }), {
    merged: { t: "c" },
    conflicts: [{ field: "t", base: "a", local: "b", remote: "c" }],
  });
  assert.deepEqual(mergeRows({ id: 1 }, { id: 2 }, { id: 3 }).conflicts, []);
});

test("mergeRows takes rows as plain JSON", () => {
  const d = new Date("2024-01-02T03:04:05.000Z");
  assert.equal(mergeRows({}, { at: d }, {}).merged.at, "2024-01-02T03:04:05.000Z");
  assert.equal("a" in mergeRows({ a: 1 }, { a: undefined }, { a: 1 }).merged, false);
});

test("sameValue compares as the database does", () => {
  assert.equal(sameValue("2024-01-01T00:00:00Z", "2024-01-01T01:00:00+01:00"), true);
  assert.equal(sameValue(null, undefined), true);
  assert.equal(sameValue({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
  assert.equal(sameValue(1, "1"), false);
});

test("ink note header round-trips and rejects unknown papers", () => {
  const defaults = defaultInkNoteMeta();
  assert.deepEqual(defaults, { pages: 1, paper: "blank", pageOrder: [], recognised: 0, engine: null, hand: "right" });
  const meta: InkNoteMeta = { pages: 2, paper: "grid", pageOrder: [], recognised: 0.5, engine: "x", hand: "left" };
  assert.deepEqual(readInkNoteBody(writeInkNoteBody(meta, "hello")), { meta, text: "hello" });
  assert.equal(isInkNoteBody(writeInkNoteBody(defaults, "")), true);
  assert.equal(isInkNoteBody("# plain"), false);
  assert.throws(() => writeInkNoteBody({ ...meta, paper: "lined" as never }, ""));
});

test("diffBody lists same, ours and theirs lines with hunks", () => {
  assert.deepEqual(diffBody("a\nb\nc", "a\nx\nc"), {
    lines: [
      { op: "same", text: "a" },
      { op: "ours", text: "b" },
      { op: "theirs", text: "x" },
      { op: "same", text: "c" },
    ],
    hunks: [{ index: 0, ours: ["b"], theirs: ["x"] }],
  });
});

test("hasConflictMarkers finds git-style markers only", () => {
  assert.equal(hasConflictMarkers("<<<<<<< this app\na\n=======\nb\n>>>>>>> the folder\n"), true);
  assert.equal(hasConflictMarkers("plain"), false);
});

test("entityDir places each type under its project root", () => {
  assert.equal(entityDir("paper"), "papers");
  assert.equal(entityDir("paper", "p--1"), "p--1/papers");
  assert.throws(() => entityDir("nope" as never));
});

test("jsonKindOfPath returns null for a path that is not a JSON entity", () => {
  assert.equal(jsonKindOfPath("notes/a.md"), null);
});

test("imageAltFromFilename accepts no name or null", () => {
  assert.equal(typeof imageAltFromFilename(), "string");
  assert.equal(typeof imageAltFromFilename(null), "string");
});

test("defaultPasteSettings matches normalizePasteSettings of nothing stored", () => {
  const defaults = defaultPasteSettings();
  assert.equal(typeof defaults.cleanOnPaste, "boolean");
  assert.deepEqual(normalizePasteSettings(undefined), defaults);
  assert.deepEqual(normalizePasteSettings("not an object"), defaults);
  assert.deepEqual(normalizePasteSettings({ ...defaults, linkRemovals: ["a.com"] }).linkRemovals, ["a.com"]);
});

test("parseLinkRemovalText keeps one trimmed rule per non-empty line", () => {
  assert.deepEqual(parseLinkRemovalText(" a.com \n\nb.org/x\n"), ["a.com", "b.org/x"]);
});

test("cleanPastedText returns text, changed and urlsCleaned", () => {
  const result = cleanPastedText("plain text", defaultPasteSettings());
  assert.deepEqual(Object.keys(result).sort(), ["changed", "text", "urlsCleaned"]);
  assert.equal(result.text, "plain text");
  assert.equal(result.changed, false);
});

test("pasteLandsInVerbatimContext takes a UTF-16 offset", () => {
  const doc = "😀\n```\ncode\n```";
  assert.equal(pasteLandsInVerbatimContext(doc, doc.indexOf("code")), true);
  assert.equal(pasteLandsInVerbatimContext("plain", 2), false);
  assert.equal(pasteLandsInVerbatimContext("plain", -5), false);
  assert.equal(pasteLandsInVerbatimContext("plain", 1.7), false);
});

test("the text cleaners return text and changed", () => {
  const wrapped = cleanWrappedText("a\nb", { rejoin: "never", bullets: "preserve" });
  assert.deepEqual(Object.keys(wrapped).sort(), ["changed", "text"]);
  assert.equal(typeof cleanPdfText("a b", {}).text, "string");
  assert.deepEqual(tabSeparatedToMarkdownTable("no tabs"), { text: "no tabs", changed: false });
  assert.equal(applyCommaPlacement("plain", "inside").changed, false);
  assert.throws(() => applyCommaPlacement("x", "middle" as never));
});

test("cleanUrlsWithRules strips tracking parameters and counts URLs", () => {
  const result = cleanUrlsWithRules("see https://example.com/a?utm_source=x", []);
  assert.equal(result.text, "see https://example.com/a");
  assert.equal(result.count, 1);
});

test("the paste wrappers reject text over MAX_INDEX_TEXT_UTF16 before WASM", () => {
  const big = "a".repeat(maxIndexTextUtf16() + 1);
  const beforeWasm = (e: unknown) => e instanceof RangeError && /MAX_INDEX_TEXT_UTF16/.test(e.message);
  assert.throws(() => cleanPastedText(big, defaultPasteSettings()), beforeWasm);
  assert.throws(() => tabSeparatedToMarkdownTable(big), beforeWasm);
  assert.throws(() => cleanUrlsWithRules(big, []), beforeWasm);
});

test("parsePaperFieldValue keeps strings and numbers, trims lists, and throws with the caller name", () => {
  assert.equal(parsePaperFieldValue("VAE", "value"), "VAE");
  assert.equal(parsePaperFieldValue(0, "value"), 0);
  assert.deepEqual(parsePaperFieldValue([" a ", "", "b"], "value"), ["a", "b"]);
  for (const bad of ["  ", [], ["", " "], [1], Number.NaN, Infinity, null, undefined, {}, true]) {
    assert.throws(
      () => parsePaperFieldValue(bad, "Proposal value"),
      /^Error: Proposal value must be a non-empty string, number, or non-empty string list\.$/,
    );
  }
});

test("computeRollupsForPapers sums and counts related values, null where there is no number", () => {
  const rollup = { id: "sum", kind: "rollup", options: ["rel:rel", "agg:sum", "src:score"] } as const;
  const count = { id: "count", kind: "rollup", options: ["rel:rel", "agg:count"] } as const;
  const defs = [{ id: "rel", kind: "relation" }, { id: "score", kind: "number" }, rollup, count] as const;
  const values = [
    { paperId: "a", fieldId: "rel", value: ["b", "c"] },
    { paperId: "b", fieldId: "score", value: 2 },
    { paperId: "c", fieldId: "score", value: 4 },
  ];
  assert.deepEqual(computeRollupsForPapers(["a", "b"], rollup, defs, values), [6, null]);
  assert.deepEqual(computeRollupsForPapers(["a", "b"], count, defs, values), [2, 0]);
});

function tidyPaper(over: { id: string } & Record<string, unknown>): TidyPaper {
  return {
    title: `A sufficiently long distinct paper title ${over.id}`,
    createdAt: "2026-01-01T00:00:00Z",
    status: null,
    summary: null,
    rating: null,
    readAt: null,
    pdfPath: null,
    tags: [],
    authors: [],
    year: null,
    venue: null,
    url: null,
    abstract: null,
    bibtex: null,
    doi: null,
    arxivId: null,
    metadata: null,
    ...over,
  } as TidyPaper;
}

test("titleFixes proposes a filename's title and a lookup for a placeholder with an identifier", () => {
  const fixes = titleFixes([
    tidyPaper({ id: "a", title: "Goyal et al. - 2017 - Accurate, Large Minibatch SGD.pdf" }),
    tidyPaper({ id: "b", title: "Catalog Page", doi: "https://doi.org/10.1/X" }),
    tidyPaper({ id: "c", title: "Full Text Search at Scale" }),
  ]);
  assert.deepEqual(fixes, [
    {
      id: "a",
      current: "Goyal et al. - 2017 - Accurate, Large Minibatch SGD.pdf",
      proposed: "Accurate, Large Minibatch SGD",
    },
    { id: "b", current: "Catalog Page", lookup: { doi: "10.1/x" } },
  ]);
});

test("findDuplicateGroups groups by DOI and arXiv id, and a title bridge between two DOIs is refused", () => {
  const groups = findDuplicateGroups([
    tidyPaper({ id: "a", doi: "10.5/abc" }),
    tidyPaper({ id: "b", doi: "https://doi.org/10.5/ABC" }),
    tidyPaper({ id: "c", arxivId: "2101.00001v1" }),
    tidyPaper({ id: "d", arxivId: "arXiv:2101.00001v3" }),
    tidyPaper({ id: "e", title: "On the Measure of Intelligence", doi: "10.1/one" }),
    tidyPaper({ id: "f", title: "On the Measure of Intelligence" }),
    tidyPaper({ id: "g", title: "On the Measure of Intelligence", doi: "10.1/erratum" }),
  ]);
  assert.deepEqual(groups, [
    { keepId: "a", ids: ["a", "b"], reason: "doi" },
    { keepId: "c", ids: ["c", "d"], reason: "arxiv" },
    { keepId: "e", ids: ["e", "f"], reason: "title" },
  ]);
});

test("pickKeeper prefers the reader's own work, and throws on an empty group", () => {
  const old = tidyPaper({ id: "old", createdAt: "2020-01-01T00:00:00Z" });
  const read = tidyPaper({ id: "read", status: "read", createdAt: "2025-01-01T00:00:00Z" });
  assert.equal(pickKeeper([old, read]), "read");
  assert.throws(() => pickKeeper([]), /pickKeeper needs at least one paper/);
});

test("isConferenceCopy is false for a preprint server venue", () => {
  assert.equal(isConferenceCopy(tidyPaper({ id: "a", venue: "ICML 2023" })), true);
  assert.equal(isConferenceCopy(tidyPaper({ id: "b", venue: "arXiv" })), false);
  assert.equal(isConferenceCopy(tidyPaper({ id: "c", venue: "  " })), false);
});
