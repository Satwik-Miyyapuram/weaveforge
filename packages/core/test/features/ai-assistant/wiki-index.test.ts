import assert from "node:assert/strict";
import test from "node:test";
import {
  INDEX_MARKER_END,
  INDEX_MARKER_START,
  buildWikiIndex,
  replaceWikiIndex,
  type WikiPageRef,
} from "../../../src/index.js";

const now = () => "2026-08-05T00:00:00.000Z";
const page = (id: string, title: string, aliases?: string[]): WikiPageRef => ({
  id,
  title,
  body: "",
  ...(aliases ? { aliases } : {}),
});

test("pages are grouped and sorted for someone scanning for a name", () => {
  const index = buildWikiIndex(
    [page("1", "Zeta"), page("2", "alpha"), page("3", "Beta"), page("4", "Attention")],
    { now },
  );

  const bullets = index.split("\n").filter((line) => line.startsWith("- "));
  assert.deepEqual(bullets, ["- [[alpha]]", "- [[Attention]]", "- [[Beta]]", "- [[Zeta]]"]);
  assert.ok(index.indexOf("### A") < index.indexOf("### B"));
  assert.ok(index.indexOf("### B") < index.indexOf("### Z"));
});

test("titles starting with a digit or symbol collect at the end", () => {
  const index = buildWikiIndex([page("1", "3D Convolution"), page("2", "Attention")], { now });
  assert.ok(index.indexOf("### A") < index.indexOf("### #"), "letters come before the symbol group");
  assert.ok(index.includes("- [[3D Convolution]]"));
});

test("aliases are named so a search for the old title lands", () => {
  const index = buildWikiIndex([page("1", "Autoencoder", ["AE", "Auto-encoder"])], { now });
  assert.match(index, /- \[\[Autoencoder\]\] — also AE, Auto-encoder/);
});

test("an empty wiki says so instead of rendering an empty list", () => {
  const index = buildWikiIndex([], { now });
  assert.match(index, /No pages yet/);
  assert.ok(index.startsWith(INDEX_MARKER_START));
  assert.ok(index.trimEnd().endsWith(INDEX_MARKER_END));
});

test("regenerating replaces the previous block and nothing else", () => {
  const first = buildWikiIndex([page("1", "Attention")], { now });
  const body = replaceWikiIndex("My own notes about this wiki.\n", first);
  assert.ok(body.startsWith("My own notes about this wiki."));

  const second = buildWikiIndex([page("1", "Attention"), page("2", "Beta")], { now });
  const rebuilt = replaceWikiIndex(body, second);

  assert.ok(rebuilt.startsWith("My own notes about this wiki."), "hand-written text survives");
  assert.equal(rebuilt.split(INDEX_MARKER_START).length - 1, 1, "exactly one generated block");
  assert.ok(rebuilt.includes("- [[Beta]]"));
});

test("text written after the block is kept too", () => {
  const index = buildWikiIndex([page("1", "Attention")], { now });
  const body = `Before\n\n${index}\n\nAfter, added by hand.\n`;
  const rebuilt = replaceWikiIndex(body, buildWikiIndex([page("2", "Beta")], { now }));

  assert.ok(rebuilt.includes("Before"));
  assert.ok(rebuilt.includes("After, added by hand."));
  assert.ok(!rebuilt.includes("Attention"), "the stale entry is gone");
});

test("a body with a start marker but no end is not half-spliced", () => {
  const damaged = `Notes\n\n${INDEX_MARKER_START}\n- [[Stale]]\n`;
  const rebuilt = replaceWikiIndex(damaged, buildWikiIndex([page("1", "Fresh")], { now }));

  assert.ok(rebuilt.includes("- [[Fresh]]"));
  assert.equal(rebuilt.split(INDEX_MARKER_END).length - 1, 1);
});

test("the page count reads correctly for one page", () => {
  assert.match(buildWikiIndex([page("1", "Attention")], { now }), /1 page\. Generated 2026-08-05/);
  assert.match(
    buildWikiIndex([page("1", "A"), page("2", "B")], { now }),
    /2 pages\. Generated 2026-08-05/,
  );
});

const count = (text: string, marker: string) => text.split(marker).length - 1;

test("a start marker without an end is replaced through the end, not duplicated (02-11)", () => {
  const damaged = `Notes\n\n${INDEX_MARKER_START}\n- [[Stale]]\n`;
  const fresh = buildWikiIndex([page("1", "Fresh")], { now });
  const rebuilt = replaceWikiIndex(damaged, fresh);

  assert.equal(rebuilt, `Notes\n\n${fresh}\n`);
  assert.equal(count(rebuilt, INDEX_MARKER_START), 1, "exactly one generated block");
  assert.ok(!rebuilt.includes("Stale"));
  // The repaired body regenerates in place on the next run.
  assert.equal(replaceWikiIndex(rebuilt, fresh), rebuilt);
});

test("a stray end marker before the block does not hide the block (02-11)", () => {
  const old = buildWikiIndex([page("1", "Stale")], { now });
  const body = `Quoting ${INDEX_MARKER_END} by hand.\n\n${old}\n\nAfter.\n`;
  const rebuilt = replaceWikiIndex(body, buildWikiIndex([page("2", "Fresh")], { now }));

  assert.equal(count(rebuilt, INDEX_MARKER_START), 1);
  assert.ok(rebuilt.startsWith(`Quoting ${INDEX_MARKER_END} by hand.`));
  assert.ok(rebuilt.endsWith("\n\nAfter.\n"));
  assert.ok(!rebuilt.includes("Stale"));
  assert.ok(rebuilt.includes("- [[Fresh]]"));
});

test("only an end marker: the index is appended and the text kept", () => {
  const body = `Notes ${INDEX_MARKER_END}\n`;
  const fresh = buildWikiIndex([page("1", "Fresh")], { now });
  assert.equal(replaceWikiIndex(body, fresh), `Notes ${INDEX_MARKER_END}\n\n${fresh}\n`);
});
