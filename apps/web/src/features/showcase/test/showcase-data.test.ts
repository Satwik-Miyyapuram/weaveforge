import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SHOWCASE_LOG,
  SHOWCASE_MILESTONES,
  SHOWCASE_PAPERS,
  SHOWCASE_RELATIONS,
  SHOWCASE_SUPERVISOR_COMMENTS,
  SHOWCASE_VAULT,
} from "../domain/showcase-data";

// The design audit (2026-10-25) needs every screen full enough to judge:
// long lists, long text, and milestones on both sides of that date.
const AUDIT_DATE = "2026-10-25";

test("papers: about 100 (a thesis library), unique, every status, one with many authors and a long title", () => {
  const titles = SHOWCASE_PAPERS.map((p) => p.title);
  assert.ok(titles.length >= 100, `papers ${titles.length}`);
  assert.equal(new Set(titles).size, titles.length);
  for (const s of ["to_read", "reading", "read"]) assert.ok(SHOWCASE_PAPERS.some((p) => p.status === s), s);
  assert.ok(SHOWCASE_PAPERS.some((p) => p.authors.length >= 12), "a paper with 12+ authors");
  assert.ok(titles.some((t) => t.length >= 90), "a title of 90+ characters");
});

test("papers: arXiv ids are well formed and unique", () => {
  const ids = SHOWCASE_PAPERS.flatMap((p) => (p.arxiv_id ? [p.arxiv_id] : []));
  for (const id of ids) assert.match(id, /^\d{4}\.\d{4,5}$/, id);
  assert.equal(new Set(ids).size, ids.length);
});

test("relations only name seeded papers", () => {
  const titles = new Set(SHOWCASE_PAPERS.map((p) => p.title));
  for (const [from, to] of SHOWCASE_RELATIONS) {
    assert.ok(titles.has(from), from);
    assert.ok(titles.has(to), to);
  }
});

test("logbook: 30+ entries over two months, one a day at most, one very long", () => {
  assert.ok(SHOWCASE_LOG.length >= 30, `log ${SHOWCASE_LOG.length}`);
  const days = SHOWCASE_LOG.map((e) => e.daysAgo);
  assert.equal(new Set(days).size, days.length, "daysAgo is unique (comments target entries by it)");
  assert.ok(Math.max(...days) >= 55, "spans two months");
  assert.ok(SHOWCASE_LOG.some((e) => e.body.length >= 1500), "one entry of 1500+ characters");
  assert.ok(SHOWCASE_LOG.some((e) => e.kind === "weekly"));
});

test("notes: 25+, unique titles, linked, and every [[link]] resolves", () => {
  const titles = SHOWCASE_VAULT.map((v) => v.title);
  assert.ok(titles.length >= 25, `notes ${titles.length}`);
  assert.equal(new Set(titles).size, titles.length);
  const known = new Set(titles);
  let linked = 0;
  for (const v of SHOWCASE_VAULT) {
    const links = [...v.body.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]!);
    if (links.length > 0) linked++;
    for (const l of links) assert.ok(known.has(l), `${v.title} links to missing "${l}"`);
  }
  assert.ok(linked >= 8, `linked notes ${linked}`);
});

test("milestones: 12+, every status, late and upcoming ones around the audit date", () => {
  assert.ok(SHOWCASE_MILESTONES.length >= 12, `milestones ${SHOWCASE_MILESTONES.length}`);
  for (const s of ["done", "in_progress", "planned", "blocked"]) {
    assert.ok(SHOWCASE_MILESTONES.some((m) => m.status === s), s);
  }
  const open = SHOWCASE_MILESTONES.filter((m) => m.status !== "done");
  assert.ok(open.some((m) => m.target_date < AUDIT_DATE), "a late milestone");
  assert.ok(open.filter((m) => m.target_date > AUDIT_DATE).length >= 2, "two upcoming milestones");
  const titles = new Set(SHOWCASE_MILESTONES.map((m) => m.title));
  for (const m of SHOWCASE_MILESTONES) {
    for (const d of m.dependencies ?? []) {
      if (d.kind === "milestone") assert.ok(titles.has(d.label!), `${m.title} depends on missing ${d.label}`);
    }
  }
});

test("supervisor comment threads point at seeded milestones and log entries", () => {
  assert.ok(SHOWCASE_SUPERVISOR_COMMENTS.length >= 4);
  const milestones = new Set(SHOWCASE_MILESTONES.map((m) => m.title));
  const days = new Set(SHOWCASE_LOG.map((e) => e.daysAgo));
  for (const t of SHOWCASE_SUPERVISOR_COMMENTS) {
    if (t.resource === "milestone") assert.ok(milestones.has(String(t.target)), String(t.target));
    else assert.ok(days.has(Number(t.target)), `log daysAgo ${t.target}`);
  }
  assert.ok(SHOWCASE_SUPERVISOR_COMMENTS.some((t) => t.replies.length > 0), "a thread with a reply");
  assert.ok(SHOWCASE_SUPERVISOR_COMMENTS.some((t) => t.replies.length === 0), "an unanswered thread");
  assert.ok(SHOWCASE_SUPERVISOR_COMMENTS.some((t) => t.resolved), "a resolved thread");
});
