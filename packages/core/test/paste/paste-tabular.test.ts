import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseTabSeparated,
  renderMarkdownTable,
  tabSeparatedToMarkdownTable,
} from "../../src/paste/tabular-text.js";
import { cleanPastedText } from "../../src/paste/clean-pasted-text.js";
import { DEFAULT_PASTE_SETTINGS } from "../../src/paste/paste-settings.js";

const convert = (text: string) => tabSeparatedToMarkdownTable(text).text;

test("a spreadsheet paste becomes a Markdown table", () => {
  const pasted = "model\tval_loss\taccuracy\nbeta-VAE\t0.1826\t0.912\nResNet-18\t0.340\t0.887";
  assert.equal(
    convert(pasted),
    [
      "| model | val_loss | accuracy |",
      "| --- | ---: | ---: |",
      "| beta-VAE | 0.1826 | 0.912 |",
      "| ResNet-18 | 0.340 | 0.887 |",
    ].join("\n"),
  );
});

test("numeric columns are right-aligned and text columns are not", () => {
  const parse = parseTabSeparated("a\tb\tc\nx\t1\t1.5%\ny\t-2\tnot a number");
  assert.ok(parse);
  const table = renderMarkdownTable(parse);
  assert.equal(table.split("\n")[1], "| --- | ---: | --- |");
});

test("thousands separators, signs and currency still read as numbers", () => {
  const parse = parseTabSeparated("cost\tn\n$1,200\t+3\n$980\t-4");
  assert.ok(parse);
  assert.equal(renderMarkdownTable(parse).split("\n")[1], "| ---: | ---: |");
});

test("a pipe in a cell cannot start a new column", () => {
  assert.equal(
    convert("a\tb\nx|y\tz"),
    "| a | b |\n| --- | --- |\n| x\\|y | z |",
  );
});

test("an empty cell keeps the row's shape", () => {
  assert.equal(convert("a\tb\n\tz"), "| a | b |\n| --- | --- |\n|   | z |");
});

test("prose is never mistaken for a table", () => {
  for (const text of [
    "one, two, three",
    "a single line\twith a tab",
    "no tabs at all\nsecond line",
    "ragged\trows\nhere\ttoo\tmany",
    "\t\n\t",
    "",
    "just one column\nof lines",
  ]) {
    assert.equal(convert(text), text, JSON.stringify(text));
  }
});

test("a comma-separated block is left alone, deliberately", () => {
  // Half the sentences in a note would qualify as CSV, and a rule that turns a
  // paragraph into a table is worse than no rule.
  const csv = "model,val_loss\nbeta-VAE,0.1826";
  assert.equal(convert(csv), csv);
});

test("a data dump past the size caps is left as text", () => {
  const wide = Array.from({ length: 60 }, (_, i) => `c${i}`).join("\t");
  assert.equal(convert(`${wide}\n${wide}`), `${wide}\n${wide}`);

  const tall = Array.from({ length: 600 }, () => "a\tb").join("\n");
  assert.equal(convert(tall), tall);
});

test("carriage returns and a trailing newline come through fine", () => {
  assert.equal(
    convert("a\tb\r\nx\ty\r\n"),
    "| a | b |\n| --- | --- |\n| x | y |",
  );
});

test("the pipeline converts on paste, and the switch turns it off", () => {
  const pasted = "model\tval_loss\nbeta-VAE\t0.1826";
  const on = cleanPastedText(pasted, DEFAULT_PASTE_SETTINGS);
  assert.equal(on.text, "| model | val_loss |\n| --- | ---: |\n| beta-VAE | 0.1826 |");
  assert.equal(on.changed, true);

  const off = cleanPastedText(pasted, { ...DEFAULT_PASTE_SETTINGS, tabsToTable: false });
  assert.equal(off.text, pasted);
});

test("converting is idempotent — a table pasted again stays one table", () => {
  const once = convert("a\tb\nx\ty");
  assert.equal(convert(once), once);
  assert.equal(cleanPastedText(once, DEFAULT_PASTE_SETTINGS).text, once);
});
