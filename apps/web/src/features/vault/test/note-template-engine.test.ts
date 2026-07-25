import assert from "node:assert/strict";
import test from "node:test";
import {
  applyTemplate,
  mergeTemplate,
  parseRegions,
  renderTemplate,
  substituteVariables,
  wrapRegion,
} from "../application/note-template-engine";

const TEMPLATE = [
  "# {{title}}",
  "",
  wrapRegion("generated", "metadata", ["- Year: {{year}}", "- Tags: {{tags}}", ""].join("\n")),
  wrapRegion("editable", "notes", ["", "Write your notes here.", ""].join("\n")),
  "",
].join("\n");

test("renderTemplate substitutes variables and leaves missing keys empty", () => {
  const out = renderTemplate(TEMPLATE, {
    title: "Attention",
    year: 2017,
    tags: ["nlp", "transformers"],
  });
  assert.match(out, /^# Attention/m);
  assert.match(out, /- Year: 2017/);
  assert.match(out, /- Tags: nlp, transformers/);
  assert.doesNotMatch(out, /undefined/);
  assert.equal(substituteVariables("Hello {{missing}}!", {}), "Hello !");
});

test("applyTemplate first render from empty produces the rendered template", () => {
  const out = applyTemplate("", TEMPLATE, { title: "X", year: 2020, tags: [] });
  assert.equal(out, renderTemplate(TEMPLATE, { title: "X", year: 2020, tags: [] }));
  assert.match(out, /<!-- wf:generated:metadata -->/);
  assert.match(out, /<!-- wf:editable:notes -->/);
});

test("mergeTemplate refreshes generated regions and preserves editable byte-for-byte", () => {
  const first = applyTemplate("", TEMPLATE, {
    title: "V1",
    year: 2017,
    tags: ["a"],
  });
  const userNotes = "\nMy week of careful notes — keep me.\n";
  const edited = first.replace(
    /<!-- wf:editable:notes -->[\s\S]*?<!-- \/wf:editable:notes -->/,
    wrapRegion("editable", "notes", userNotes),
  );

  const merged = applyTemplate(edited, TEMPLATE, {
    title: "V2",
    year: 2018,
    tags: ["b", "c"],
  });

  assert.match(merged, /- Year: 2018/);
  assert.match(merged, /- Tags: b, c/);
  assert.equal(
    merged.slice(
      merged.indexOf("<!-- wf:editable:notes -->") + "<!-- wf:editable:notes -->".length,
      merged.indexOf("<!-- /wf:editable:notes -->"),
    ),
    userNotes,
  );
  // Title sits outside markers in the template skeleton; merge rebuilds from
  // the existing structure, so unmarked existing text (including the old title
  // line) is preserved rather than overwritten.
  assert.match(merged, /^# V1/m);
});

test("mergeTemplate preserves unmarked user content outside all markers", () => {
  const base = applyTemplate("", TEMPLATE, { title: "T", year: 1, tags: [] });
  const withFreeform = `${base}\n\n## My appendix\n\nDo not touch.\n`;
  const merged = mergeTemplate(
    withFreeform,
    renderTemplate(TEMPLATE, { title: "T", year: 2, tags: ["x"] }),
  );
  assert.match(merged, /## My appendix/);
  assert.match(merged, /Do not touch\./);
  assert.match(merged, /- Year: 2/);
  assert.ok(merged.endsWith("Do not touch.\n") || merged.includes("Do not touch.\n"));
});

test("mergeTemplate preserves everything when markers are malformed", () => {
  const damaged = [
    "# Title",
    "<!-- wf:generated:metadata -->",
    "- Year: 2017",
    // missing close marker
    "<!-- wf:editable:notes -->",
    "user text",
    "<!-- /wf:editable:notes -->",
  ].join("\n");

  const rendered = renderTemplate(TEMPLATE, { title: "N", year: 9, tags: [] });
  assert.equal(mergeTemplate(damaged, rendered), damaged);
  assert.equal(parseRegions(damaged).ok, false);
});

test("mergeTemplate preserves everything when a close marker is half-deleted", () => {
  const damaged = [
    wrapRegion("generated", "metadata", "- Year: 1\n"),
    "<!-- wf:editable:notes -->",
    "keep me",
    "<!-- /wf:editable:note -->", // wrong name
  ].join("\n");
  const rendered = renderTemplate(TEMPLATE, { title: "N", year: 9, tags: [] });
  assert.equal(mergeTemplate(damaged, rendered), damaged);
});

test("round trip: user editable text stays byte-identical across re-renders", () => {
  let doc = applyTemplate("", TEMPLATE, { title: "R", year: 2020, tags: ["t"] });
  const payload = "Line A\nLine B with [[wikilink]] and $math$\n";
  doc = doc.replace(
    /<!-- wf:editable:notes -->[\s\S]*?<!-- \/wf:editable:notes -->/,
    wrapRegion("editable", "notes", payload),
  );

  for (let i = 0; i < 3; i++) {
    doc = applyTemplate(doc, TEMPLATE, {
      title: `R${i}`,
      year: 2020 + i,
      tags: [`t${i}`],
    });
  }

  const start = doc.indexOf("<!-- wf:editable:notes -->") + "<!-- wf:editable:notes -->".length;
  const end = doc.indexOf("<!-- /wf:editable:notes -->");
  assert.equal(doc.slice(start, end), payload);
});
