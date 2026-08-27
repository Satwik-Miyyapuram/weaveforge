/**
 * The PRISMA figure.
 *
 * What is worth asserting is that the numbers reach the boxes and that prose a
 * reviewer typed cannot end the document: a reason containing `\end{figure}`
 * or a bare `&` is the difference between a report that compiles and one that
 * fails somewhere else entirely.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { prismaCounts } from "../../../src/features/reading-lists/domain/screening.js";
import {
  prismaCaveat,
  prismaFigureTex,
} from "../../../src/features/report/domain/prisma-figure.js";

const counts = prismaCounts(
  [{ id: "a" }, { id: "b" }, { id: "c", duplicateOfItemId: "a" }],
  [
    {
      id: "1",
      itemId: "a",
      reviewerId: "ana",
      stage: "title_abstract",
      state: "included",
      decidedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "2",
      itemId: "a",
      reviewerId: "ana",
      stage: "full_text",
      state: "included",
      decidedAt: "2026-01-01T00:00:01.000Z",
    },
    {
      id: "3",
      itemId: "b",
      reviewerId: "ana",
      stage: "title_abstract",
      state: "excluded",
      decidedAt: "2026-01-01T00:00:02.000Z",
    },
  ],
);

test("the counts reach the boxes", () => {
  const tex = prismaFigureTex(counts);
  assert.match(tex, /Records identified \(n = 3\)/);
  assert.match(tex, /Duplicates removed \(n = 1\)/);
  assert.match(tex, /Records screened \(n = 2\)/);
  assert.match(tex, /Studies included \(n = 1\)/);
  assert.match(tex, /\\begin\{figure\}/);
  assert.match(tex, /\\end\{figure\}/);
});

test("a reason a reviewer typed cannot end the document", () => {
  const tex = prismaFigureTex(counts, {
    reasons: [{ reason: "50% dropout & \\end{figure} #1", count: 2 }],
  });
  // One `\end{figure}`, at the end, where this file put it.
  assert.equal(tex.match(/\\end\{figure\}/g)?.length, 1);
  assert.match(tex, /50\\% dropout \\& \\textbackslash\{\}end/);
});

test("a caption and label are the caller's to choose", () => {
  const tex = prismaFigureTex(counts, { caption: "How we chose.", label: "fig:selection" });
  assert.match(tex, /\\caption\{How we chose\.\}/);
  assert.match(tex, /\\label\{fig:selection\}/);
});

test("what is unsettled is said beside the figure, never inside it", () => {
  assert.equal(prismaCaveat(counts), null);
  const caveat = prismaCaveat({ ...counts, undecided: 4, conflicts: 1 });
  assert.match(String(caveat), /4 not yet screened/);
  assert.match(String(caveat), /1 where reviewers disagree/);
  assert.doesNotMatch(prismaFigureTex({ ...counts, undecided: 4 }), /not yet screened/);
});
