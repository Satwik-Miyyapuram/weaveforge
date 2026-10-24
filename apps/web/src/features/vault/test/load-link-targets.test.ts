/**
 * The vault's link targets say when they could not be loaded (xlog-10).
 *
 * Papers and report sections feed `[[wikilink]]` resolution. A failed load
 * used to become an empty list, so every link to a paper looked broken and
 * nothing said why.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { AppLogInput } from "@/lib/error-report/app-log";
import { loadLinkTargets } from "@/features/vault/application/load-link-targets";

const papers = async () => ({ papers: [{ id: "p1", title: "Paper", extra: 1 }] });
const sections = async () => ({ flat: [{ id: "s1", title: "Intro", depth: 0 }] });
const fails = (msg: string) => async () => Promise.reject(new Error(msg));

test("both loads succeed: entries, no error, nothing logged", async () => {
  const logs: AppLogInput[] = [];
  const t = await loadLinkTargets({ papers, sections }, (e) => void logs.push(e));
  assert.deepEqual(t.paperEntries, [{ id: "p1", title: "Paper" }]);
  assert.deepEqual(t.sectionEntries, [{ id: "s1", title: "Intro" }]);
  assert.equal(t.error, null);
  assert.equal(logs.length, 0);
});

test("a failed papers load is reported and logged; sections still load", async () => {
  const logs: AppLogInput[] = [];
  const t = await loadLinkTargets({ papers: fails("403"), sections }, (e) => void logs.push(e));
  assert.deepEqual(t.paperEntries, []);
  assert.deepEqual(t.sectionEntries, [{ id: "s1", title: "Intro" }]);
  assert.match(t.error ?? "", /papers/);
  assert.doesNotMatch(t.error ?? "", /sections/);
  assert.equal(logs.length, 1);
  assert.match(logs[0]!.detail ?? "", /403/);
});

test("both failing names both, and logs each", async () => {
  const logs: AppLogInput[] = [];
  const t = await loadLinkTargets({ papers: fails("a"), sections: fails("b") }, (e) => void logs.push(e));
  assert.match(t.error ?? "", /papers and report sections/);
  assert.equal(logs.length, 2);
});

test("empty lists are not an error", async () => {
  const t = await loadLinkTargets(
    { papers: async () => ({ papers: [] }), sections: async () => ({ flat: [] }) },
    () => assert.fail("nothing to log"),
  );
  assert.equal(t.error, null);
  assert.deepEqual(t.paperEntries, []);
});
