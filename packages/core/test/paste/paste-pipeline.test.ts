import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanPastedText,
  looksLikePdfText,
  pasteLandsInVerbatimContext,
} from "../../src/paste/clean-pasted-text.js";
import {
  DEFAULT_PASTE_SETTINGS,
  normalizePasteSettings,
  parseLinkRemovalText,
} from "../../src/paste/paste-settings.js";
import { applyCommaPlacement } from "../../src/paste/quote-commas.js";

test("the defaults repair without imposing a house style", () => {
  const result = cleanPastedText(
    "\n  Read https://a.example/x?utm_source=news\u200B \u201Cnow\u201D \u2014 today  \n",
  );
  // Tracker gone, zero-width gone, blank line gone; quotes and dashes kept.
  assert.equal(result.text, "Read https://a.example/x \u201Cnow\u201D \u2014 today");
  assert.equal(result.urlsCleaned, 1);
  assert.equal(result.changed, true);
});

test("the master switch returns the clipboard untouched", () => {
  const raw = "  https://a.example/x?utm_source=news  ";
  const result = cleanPastedText(raw, { ...DEFAULT_PASTE_SETTINGS, cleanOnPaste: false });
  assert.equal(result.text, raw);
  assert.equal(result.changed, false);
});

test("quotes and dashes run once turned on, and stay out of a URL", () => {
  const settings = { ...DEFAULT_PASTE_SETTINGS, straightenQuotes: true, straightenDashes: true };
  const result = cleanPastedText("“don’t” — https://a.example/2013–2014", settings);
  assert.equal(result.text, "\"don't\" - https://a.example/2013–2014");
});

test("a paste inside code or frontmatter is left to the writer", () => {
  const document = "intro\n\n```\nlet x = 1;\n```\n";
  const insideFence = document.indexOf("let x");
  assert.equal(pasteLandsInVerbatimContext(document, insideFence), true);
  assert.equal(pasteLandsInVerbatimContext(document, 2), false);

  const note = "---\ntitle: A\n---\n\nbody";
  assert.equal(pasteLandsInVerbatimContext(note, note.indexOf("title")), true);
  assert.equal(pasteLandsInVerbatimContext(note, note.indexOf("body")), false);
});

test("PDF text is recognised by its wrapping, not by hope", () => {
  assert.equal(
    looksLikePdfText(
      "The findings suggest that long-term expo-\nsure has a measurable effect on the out-\ncome in both groups.",
    ),
    true,
  );
  assert.equal(looksLikePdfText("a short note\nwith two lines"), false);
  assert.equal(looksLikePdfText("The ﬁnancial effect"), true);
});

test("stored settings are clamped rather than trusted", () => {
  assert.deepEqual(normalizePasteSettings(null), DEFAULT_PASTE_SETTINGS);
  assert.deepEqual(normalizePasteSettings("nonsense"), DEFAULT_PASTE_SETTINGS);

  const normalized = normalizePasteSettings({
    cleanLinks: "yes",
    straightenQuotes: true,
    linkRemovals: ["  fbclid  ", "", 42, "x".repeat(500)],
    unknown: 1,
  });
  // A non-boolean falls back to its default rather than reaching the rules.
  assert.equal(normalized.cleanLinks, true);
  assert.equal(normalized.straightenQuotes, true);
  assert.equal(normalized.linkRemovals.length, 2);
  assert.equal(normalized.linkRemovals[0], "fbclid");
  assert.equal(normalized.linkRemovals[1]?.length, 200);

  const tooMany = normalizePasteSettings({ linkRemovals: Array.from({ length: 500 }, (_, i) => `p${i}`) });
  assert.equal(tooMany.linkRemovals.length, 200);
});

test("the settings textarea splits into rules", () => {
  assert.deepEqual(parseLinkRemovalText("fbclid\n\n  site.example | a  \n"), [
    "fbclid",
    "site.example | a",
  ]);
});

test("commas move only where the text is really quoted prose", () => {
  assert.equal(
    applyCommaPlacement('She called it "finished," then left.', "outside").text,
    'She called it "finished", then left.',
  );
  assert.equal(
    applyCommaPlacement('She called it "finished", then left.', "inside").text,
    'She called it "finished," then left.',
  );
  // CSV and JSON are data, and stay exactly as they are.
  const csv = 'name,"John Smith", age';
  assert.equal(applyCommaPlacement(csv, "outside").text, csv);
  const json = '{"name":"Anna", "city":"Berg"}';
  assert.equal(applyCommaPlacement(json, "outside").text, json);
});
