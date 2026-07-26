import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SOURCE_NOTE_TEMPLATE,
  sourceNoteTemplateContext,
} from "../application/default-source-note-template";
import { applyTemplate } from "../application/note-template-engine";

test("default template first render fills metadata and editable regions", () => {
  const out = applyTemplate(
    null,
    DEFAULT_SOURCE_NOTE_TEMPLATE,
    sourceNoteTemplateContext({
      title: "Attention Is All You Need",
      authors: ["A. Vaswani", "N. Shazeer"],
      year: 2017,
      doi: "10.5555/3295222",
      citeKey: "vaswani2017",
    }),
  );
  assert.match(out, /# Attention Is All You Need/);
  assert.match(out, /<!-- wf:generated:metadata -->/);
  assert.match(out, /- Authors: A\. Vaswani, N\. Shazeer/);
  assert.match(out, /- Year: 2017/);
  assert.match(out, /- Cite key: vaswani2017/);
  assert.match(out, /<!-- wf:editable:notes -->/);
  assert.doesNotMatch(out, /undefined/);
});

test("re-render refreshes generated metadata but preserves editable notes byte-for-byte", () => {
  const first = applyTemplate(
    null,
    DEFAULT_SOURCE_NOTE_TEMPLATE,
    sourceNoteTemplateContext({ title: "Paper", year: 2017 }),
  );

  const myNotes = "\nWeeks of careful reading — DO NOT LOSE.\n";
  const edited = first.replace(
    /<!-- wf:editable:notes -->[\s\S]*?<!-- \/wf:editable:notes -->/,
    `<!-- wf:editable:notes -->${myNotes}<!-- /wf:editable:notes -->`,
  );

  const reRendered = applyTemplate(
    edited,
    DEFAULT_SOURCE_NOTE_TEMPLATE,
    sourceNoteTemplateContext({ title: "Renamed Paper", year: 2020, venue: "NeurIPS" }),
  );

  assert.match(reRendered, /# Renamed Paper/);
  assert.match(reRendered, /- Year: 2020/);
  assert.match(reRendered, /- Venue: NeurIPS/);
  assert.doesNotMatch(reRendered, /^# Paper$/m);
  const start = reRendered.indexOf("<!-- wf:editable:notes -->") + "<!-- wf:editable:notes -->".length;
  const end = reRendered.indexOf("<!-- /wf:editable:notes -->");
  assert.equal(reRendered.slice(start, end), myNotes);
});

test("re-render preserves unmarked freeform text the researcher added", () => {
  const first = applyTemplate(
    null,
    DEFAULT_SOURCE_NOTE_TEMPLATE,
    sourceNoteTemplateContext({ title: "Paper", year: 2017 }),
  );
  const withAppendix = `${first}\n\n## My appendix\n\nKeep this.\n`;
  const reRendered = applyTemplate(
    withAppendix,
    DEFAULT_SOURCE_NOTE_TEMPLATE,
    sourceNoteTemplateContext({ title: "Paper", year: 2021 }),
  );
  assert.match(reRendered, /## My appendix/);
  assert.match(reRendered, /Keep this\./);
});
