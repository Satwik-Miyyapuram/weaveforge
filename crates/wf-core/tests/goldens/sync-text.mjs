// Writes tests/goldens/sync-text.json from the TypeScript body diff, change origin,
// snapshot delta, frontmatter and folder layout. Run from the repo root on Node 24:
//   node crates/wf-core/tests/goldens/sync-text.mjs
import { writeFileSync } from "node:fs";
import { diffBody, mergeHunks, writeConflictMarkers, hasConflictMarkers } from "../../../../packages/core/src/workspace/text-diff.ts";
import { digestText, changedSide } from "../../../../packages/core/src/workspace/change-origin.ts";
import { planDelta, applyDelta } from "../../../../packages/core/src/workspace/snapshot-delta.ts";
import { writeFrontmatter, readFrontmatter, frontmatterString, frontmatterList } from "../../../../packages/core/src/workspace/frontmatter.ts";
import * as L from "../../../../packages/core/src/workspace/folder-layout.ts";

const pairs = [
  ["", ""], ["a", ""], ["", "a"], ["a", "a"], ["a\nb\nc", "a\nb\nc"], ["a\nb\nc", "a\nx\nc"], ["a\nb\nc", "a\nc"],
  ["a\nc", "a\nb\nc"], ["a\r\nb\r\nc", "a\nb\nc"], ["a\rb", "a\nb"], ["x\ny", "p\nq"], ["a\nb\nc\nd\ne", "a\nB\nc\nD\ne"],
  ["one\ntwo\nthree\n", "one\nthree\nfour\n"], ["same\n", "same"], ["a\nb\na\nb", "b\na\nb\na"], ["a\n\n\nb", "a\nb"],
  ["<<<<<<< this app\nx\n=======\ny\n>>>>>>> the folder", "z"], ["héllo\n日本", "hello\n日本"], ["a\nb", "a\nb\n"],
];
const picks = [{}, { 0: "theirs" }, { 0: "both" }, { 0: "ours", 1: "theirs" }, { 1: "both" }, { 5: "theirs" }];
const diff = pairs.map(([ours, theirs]) => ({
  ours, theirs, body: diffBody(ours, theirs),
  merged: picks.map((p) => [p, mergeHunks(ours, theirs, p)]),
  markers: writeConflictMarkers(ours, theirs),
}));
// The ceiling: 2001 x 2000 lines is past 4M cells, so one hunk holds both copies whole.
const big = Array.from({ length: 2001 }, (_, i) => `o${i}`).join("\n");
const big2 = Array.from({ length: 2000 }, (_, i) => (i === 7 ? "o7" : `t${i}`)).join("\n");
const ceiling = { hunks: diffBody(big, big2).hunks.length, lines: diffBody(big, big2).lines.length, oursFirst: diffBody(big, big2).lines[0] };
const markerTexts = ["", "a", "<<<<<<< this app\nx", "<<<<<<< this app\nx\n>>>>>>> the folder", "<<<<<<< HEAD\na\n=======\nb\n>>>>>>> main",
  "<<<<<<<\n>>>>>>>", "<<<<<<<x\n>>>>>>>", "<<<<<<< a\r\n>>>>>>> b", "Title\n=======\n", ">>>>>>> x\n<<<<<<< y", "  <<<<<<< x\n>>>>>>> y",
  "<<<<<<<\t\n>>>>>>>\t", "<<<<<<<< x\n>>>>>>>> y", "<<<<<<< this appX\n>>>>>>> the folderY"];
const hasMarkers = markerTexts.map((t) => [t, hasConflictMarkers(t)]);

const digestInputs = ["", "a", "ab", "hello world", "héllo", "日本語", "😀", "\u{10000}", "a\r\nb", "x".repeat(1000), "\0", "￿"];
const digest = digestInputs.map((t) => [t, digestText(t)]);
const u = undefined;
const origins = [[u, u, u], ["a", u, u], ["a", "a", u], ["a", u, "a"], [u, "a", "a"], [u, "a", "b"], ["a", "a", "a"], ["a", "b", "a"],
  ["a", "a", "b"], ["a", "b", "c"], ["a", "b", "b"], ["a", "", ""], ["", "", "x"]];
const side = origins.map(([base, folder, workspace]) => [{ base, folder, workspace }, changedSide({ base, folder, workspace })]);

const s = (id, updatedAt) => ({ id, updatedAt });
const deltas = [
  [[], []], [[s("a", "1")], []], [[], [["a", "1"]]], [[s("a", "1")], [["a", "1"]]], [[s("a", "2")], [["a", "1"]]],
  [[s("a", "1"), s("b", "1"), s("c", "1")], [["c", "1"], ["d", "1"], ["a", "0"]]], [[s("a", "1"), s("a", "1")], [["a", "1"]]],
  [[s("a", "1"), s("a", "2")], [["a", "1"]]],
];
const plan = deltas.map(([remote, held]) => ({ remote, held, out: planDelta(remote, new Map(held)) }));
const r = (id, v) => ({ id, v });
const applies = [
  [[], [], []], [[r("a", 1)], [], [s("a", "")]], [[r("a", 1), r("b", 1)], [r("b", 2), r("c", 2)], [s("c", ""), s("b", ""), s("a", "")]],
  [[r("a", 1)], [], [s("z", "")]], [[r("a", 1), r("a", 2)], [], [s("a", "")]], [[r("a", 1)], [r("a", 2), r("a", 3)], [s("a", ""), s("a", "")]],
];
const apply = applies.map(([held, fetched, order]) => ({ held, fetched, order, out: applyDelta(held, fetched, order) }));

const fmWrite = [
  [{}, ""], [{ title: "Hello" }, "body"], [{ a: "", b: "x y", c: "true", d: "False", e: "null", f: "~", g: "12", h: "-1", i: "a\"b", j: "a\\b" }, "\n"],
  [{ n: 1, m: -2.5, z: 0, big: 1e21, small: 1e-7, neg0: -0, f: 0.1 + 0.2, t: true, ff: false }, "b"],
  [{ l: [], m: ["a"], k: ["a b", "c,d", "", "1", "x\"y"], u: undefined, v: "ok" }, "x"], [{ "weird key": "v", "k:": "v" }, ""],
  [{ e: "é", p: "a.b/c@d+e-f_g" }, ""], [{ s: " lead" }, ""],
];
const written = fmWrite.map(([fm, body]) => [fm, body, writeFrontmatter(fm, body)]);
const fmRead = [
  "", "no frontmatter", "---\n---\nbody", "---\ntitle: x\n---\nbody", "﻿---\ntitle: x\n---\nbody", "---\r\ntitle: x\r\n---\r\nbody",
  "---\ntitle: x\n---", "---\ntitle: x\n---body", "---\na: 1\nb: -2.5\nc: 1.\nd: 01\ne: true\nf: TRUE\ng: \"q\\\"x\"\nh: 'it''s'\ni: \"\"\n---\n",
  "---\nl: [a, \"b, c\", '', d ]\nm: []\nn: [ ]\no: [\"x\\\"y\", z]\np: [a,,b]\n---\n", "---\nlist:\n  - a\n  - \"b\"\n\n  - \n- c\n---\n",
  "---\nmap:\n  k: v\n  - a\nnext: 1\n---\n", "---\nempty:\nafter: 2\n---\n", "---\n  indented: 1\nkey with space: 2\nok_key-1: 3\n---\n",
  "---\nx: [unclosed\ny: a: b\n---\n", "---\ndup: 1\ndup: 2\n---\n", "---\ntitle: x\n---\n---\ny: 2\n---\n", "---\nt: x\n---\r\nrest",
  "---\nlist:\n\t- a\n---\n", "---\nk: \"unterminated\n---\n", "---\nk: [\"a\" , \"b\"]\n---\n",
];
const read = fmRead.map((c) => [c, readFrontmatter(c)]);
const fmObj = { s: " x ", e: "", n: 3, b: false, l: ["a", "b"], le: [], w: "  " };
const getters = Object.keys({ ...fmObj, missing: 1 }).map((k) => [k, frontmatterString(fmObj, k) ?? null, frontmatterList(fmObj, k)]);

const titles = ["", "Hello World", "  --Hello--  ", "Café Ångström", "日本語のタイトル", "con", "CON", "aux", "com1", "com0", "lpt9", "nul.txt",
  "a".repeat(100), "é".repeat(100), "😀 emoji", "x😀y", "ﬁle", "Ⅻ", "ΣΑΣ", "İstanbul", "a_b-c.d", "---", "😀", "a".repeat(79) + "😀",
  "Ａｂｃ", "x́y", "Straße", "ǅ"];
const slugs = titles.map((t) => [t, L.slugFor(t), L.slugFor(t, "project")]);
const ids = ["", "abc", "a-b-c-d-e-f-g", "1234567890", "--", "日本", "AbC_dE.fGh"].map((id) => [id, L.idSuffix(id)]);
const names = ["methods--a1b2c3.note.md", "x.ink.md", "x.md", "x.foo.md", "x.paper.md", "dir/y.list.md", "x.Note.md", "x.note.md.bak",
  ".note.md", "x.log", "a.b.c.report.md", "x.experiment.md", "x.milestone.md", "x.log.md", "x.list.MD", "x.my_kind.md"];
const kinds = names.map((n) => [n, L.parseKindSuffix(n), L.stripKindSuffix(n)]);
const project = [[{ id: "abcdef123", name: "My Project" }], [{ id: "", name: "" }], [{ id: "p-1", name: "con" }]].map(([p]) => [p, L.projectDir(p)]);
const types = Object.keys(L.ENTITY_DIRS);
const dirs = types.map((t) => [t, L.ENTITY_DIRS[t], L.KIND_SUFFIX[t], L.entityDir(t), L.entityDir(t, "proj--abc"),
  L.flatPath(t, "id-123456789", "A Title", ""), L.flatPath(t, "id", "", "root")]);
const logs = [["abc", "2026-03-14"], ["abc", "2026"], ["abc", ""], ["abc", "2026-03-14"], ["x", "a-b-c"]].map(([id, d], i) =>
  [id, d, i === 3 ? "proj" : "", L.logPath(id, d, i === 3 ? "proj" : "")]);
const n = (id, title, parentId) => ({ id, title, parentId });
const trees = [
  [], [n("a", "Alpha")], [n("a", "Alpha"), n("b", "Beta", "a"), n("c", "Gamma", "b")], [n("a", "Same"), n("b", "Same"), n("c", "Same")],
  [n("a", "Same", "p"), n("b", "Same"), n("p", "Parent")], [n("a", "A", "b"), n("b", "B", "a")], [n("a", "A", "a")],
  [n("a", "A", "missing")], [n("x1", "Dup"), n("x2", "Dup"), n("c", "Child", "x2")], [n("a", "A", "")],
];
const tree = trees.flatMap((nodes) => [
  [nodes, "vault_page", "", [...L.treePaths(nodes, "vault_page")]],
  [nodes, "ink_page", "proj", [...L.treePaths(nodes, "ink_page", "proj")]],
]);
const misc = { metaDir: L.WORKSPACE_META_DIR, assetDir: L.ASSET_DIR, pdfDir: L.PAPER_PDF_DIR, htmlDir: L.PAPER_HTML_DIR,
  projectMeta: L.projectMetaDir("p"), pdf: [L.paperPdfPath("id1"), L.paperPdfPath("id1", "p")], html: [L.paperHtmlPath("id1"), L.paperHtmlPath("id1", "p")],
  asset: [L.assetPath("notes", "u/p/f.png"), L.assetPath("papers", "x"), L.assetPath("report", "")] };

const out = (name, value) => writeFileSync(new URL(`./${name}.json`, import.meta.url), `${JSON.stringify(value, null, 1)}\n`);
out("sync-text-diff", { diff, ceiling, hasMarkers });
out("sync-origin", { digest, side, plan, apply });
out("sync-frontmatter", { written, read, getters });
out("sync-layout", { slugs, ids, kinds, project, dirs, logs, tree, misc });
