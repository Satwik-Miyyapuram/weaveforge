/**
 * Supervision had two pickers for one job: the "Your team" list and a
 * "Viewing" dropdown in the header. Its "Live" badge never said what live
 * meant (design D22, DA-142). The team list is the one picker; each source
 * badge explains itself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const screen = readFileSync(fileURLToPath(new URL("../ui/supervision-screen.tsx", import.meta.url)), "utf8");

test("the team list is the only student picker", () => {
  assert.doesNotMatch(screen, /<MemberTreeSelect/);
  assert.doesNotMatch(screen, />Viewing</);
  assert.match(screen, /<nav className="card superv-team" aria-label="Your team">/);
});

test("the Live and Snapshot badges say what they mean", () => {
  const badges = screen.match(/<span\s+className=\{`superv-source[^]*?<\/span>/g) ?? [];
  assert.ok(badges.length >= 2, "milestones and logbook both carry a badge");
  for (const badge of badges) assert.match(badge, /title=\{sourceTitle\(showFrozen\)\}/);
  assert.match(screen, /"Live: current data, not a published snapshot"/);
});
