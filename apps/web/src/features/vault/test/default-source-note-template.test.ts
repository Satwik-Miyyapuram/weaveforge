import assert from "node:assert/strict";
import test, { before } from "node:test";
import { readyCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

type SourceNoteInput = Parameters<ReturnType<typeof readyCore>["sourceNoteTemplateContext"]>[0];
const sourceNoteTemplateContext = (input: SourceNoteInput) => readyCore().sourceNoteTemplateContext(input);

type Core = ReturnType<typeof readyCore>;
// Each call reads the core lazily, so the module loads before the core does.
const lazy = <K extends keyof Core>(key: K): Core[K] =>
  ((...args: unknown[]) => (readyCore()[key] as (...a: unknown[]) => unknown)(...args)) as Core[K];

before(async () => {
  await loadTestCore();
});
const applyTemplate = lazy("applyTemplate");
const defaultSourceNoteTemplate = () => readyCore().defaultSourceNoteTemplate();

test("default template first render fills metadata and editable regions", () => {
  const out = applyTemplate(
    null,
    defaultSourceNoteTemplate(),
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
    defaultSourceNoteTemplate(),
    sourceNoteTemplateContext({ title: "Paper", year: 2017 }),
  );

  const myNotes = "\nWeeks of careful reading — DO NOT LOSE.\n";
  const edited = first.replace(
    /<!-- wf:editable:notes -->[\s\S]*?<!-- \/wf:editable:notes -->/,
    `<!-- wf:editable:notes -->${myNotes}<!-- /wf:editable:notes -->`,
  );

  const reRendered = applyTemplate(
    edited,
    defaultSourceNoteTemplate(),
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
    defaultSourceNoteTemplate(),
    sourceNoteTemplateContext({ title: "Paper", year: 2017 }),
  );
  const withAppendix = `${first}\n\n## My appendix\n\nKeep this.\n`;
  const reRendered = applyTemplate(
    withAppendix,
    defaultSourceNoteTemplate(),
    sourceNoteTemplateContext({ title: "Paper", year: 2021 }),
  );
  assert.match(reRendered, /## My appendix/);
  assert.match(reRendered, /Keep this\./);
});
