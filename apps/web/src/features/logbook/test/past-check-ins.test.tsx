/**
 * A student sent check-ins and never saw them again, the supervisor had no way
 * to answer one, and the same thing was a "snapshot" in one place and a
 * "check-in" in another (design D-19, D-23, S-15, D24). The logbook lists past
 * check-ins newest first, each with the shared comments sheet, and the
 * supervisor's review panel opens the same sheet on the check-in they read.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import type { LabSnapshot } from "@weaveforge/core";
import { PastCheckIns, newestFirst } from "../ui/past-check-ins";

const src = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");
const snap = (id: string, publishedAt: string) =>
  ({ id, projectId: "p", title: `Check-in ${id}`, content: { milestones: [], logs: [] }, publishedAt, createdAt: publishedAt }) as LabSnapshot;

test("past check-ins are newest first", () => {
  const list = [snap("a", "2026-09-01T10:00:00Z"), snap("c", "2026-10-20T10:00:00Z"), snap("b", "2026-10-01T10:00:00Z")];
  assert.deepEqual(newestFirst(list).map((s) => s.id), ["c", "b", "a"]);
  assert.deepEqual(list.map((s) => s.id), ["a", "c", "b"], "the input is left alone");
});

test("each check-in has a title, a date and a comments button", () => {
  const html = renderToStaticMarkup(
    <PastCheckIns snapshots={[snap("a", "2026-09-01T10:00:00Z"), snap("b", "2026-10-01T10:00:00Z")]} error={null} />,
  );
  assert.match(html, /<h2>Past check-ins<\/h2>/);
  assert.ok(html.indexOf("Check-in b") < html.indexOf("Check-in a"), "newest first");
  assert.match(html, /<time datetime="2026-10-01T10:00:00Z"[^>]*>2026-10-01<\/time>/i);
  assert.equal(html.match(/aria-label="Comments"/g)?.length, 2);
});

test("the comments are the shared sheet on the check-in itself", () => {
  const ui = src("logbook/ui/past-check-ins.tsx");
  assert.match(ui, /<CommentsToggle resourceType="lab_snapshot" resourceId=\{s\.id\} canComment isOwner \/>/);
  // The supervisor answers on the check-in they are reading.
  const superv = src("org/ui/supervision-screen.tsx");
  assert.match(superv, /<CommentsToggle\s+variant="detail"\s+resourceType="lab_snapshot"\s+resourceId=\{selectedSnapshot\.id\}\s+canComment\s+\/>/);
});

test("nothing sent yet, or offline, says so instead of an empty card", () => {
  assert.match(renderToStaticMarkup(<PastCheckIns snapshots={[]} error={null} />), /No check-ins sent yet/);
  assert.match(
    renderToStaticMarkup(<PastCheckIns snapshots={[]} error="offline" />),
    /Past check-ins show when you are online/,
  );
});

test("the logbook lists them and reloads after sending one", () => {
  const screen = src("logbook/ui/logbook-screen.tsx");
  assert.match(screen, /getContainer\(\)\.org\.listMyLabSnapshots\(\)/);
  assert.match(screen, /<PastCheckIns snapshots=\{checkIns\} error=\{checkInsError\} \/>/);
  assert.match(screen, /onPublished=\{\(\) => \{ setPublishOpen\(false\); void loadCheckIns\(\); \}\}/);
});

test("one name: check-in, everywhere", () => {
  const screen = src("logbook/ui/logbook-screen.tsx");
  assert.match(screen, /\{busy \? "Sending…" : "Send check-in"\}/);
  assert.doesNotMatch(screen, /"Publish"/);
  const superv = src("org/ui/supervision-screen.tsx");
  assert.match(superv, /Check-ins \(\{snapshots\.length\}\)/);
  assert.doesNotMatch(superv, /[Pp]ublished snapshots/);
});

test("past check-ins stay on screen at every width", () => {
  const css = readFileSync(fileURLToPath(new URL("../../../app/styles/entity-detail.css", import.meta.url)), "utf8");
  // Every narrow-screen block: none may hide the overview panel or the check-ins in it.
  const narrow = [...css.matchAll(/@media \(max-width: (\d+)px\)[^{]*\{([\s\S]*?)\n\}/g)];
  assert.ok(narrow.length > 0);
  for (const [, width, body] of narrow) {
    for (const rule of body!.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const [, sel, decl] = rule;
      if (/display:\s*none/.test(decl!)) {
        assert.doesNotMatch(sel!, /\.log-side\b|\.log-check-ins\b/, `hidden under ${width}px: ${sel!.trim()}`);
      }
    }
  }
  // Below 1100px the overview leads the timeline instead of sitting beside it.
  assert.match(css, /@media \(max-width: 1100px\) \{[^}]*\}\s*\.log-side \{[^}]*position: static;[^}]*order: -1;/);
});
