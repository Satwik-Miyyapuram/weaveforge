/**
 * One heading slug for the read view's ids and the outline's links (13-06,
 * 28-23, xhelp-11). Saved `[[Note#Heading]]` links and TOC clicks depend on
 * these exact strings, so the fixtures are pinned.
 */

import assert from "node:assert/strict";
import { before, test } from "node:test";

import { renderProseMarkdown } from "@/components/markdown/markdown";
import { readyCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

before(async () => {
  await loadTestCore();
});

const FIXTURES: [string, string][] = [
  ["Introduction", "introduction"],
  ["Baselines & β-VAE", "baselines-β-vae"],
  ["  Trailing —", "trailing"],
  ["2.1 Results (final)", "2-1-results-final"],
  ["Überblick über Daten", "überblick-über-daten"],
  ["日本語 見出し", "日本語-見出し"],
  ["---", ""],
  ["", ""],
];

test("slugs are unchanged for existing headings", () => {
  for (const [text, slug] of FIXTURES) assert.equal(readyCore().headingSlug(text), slug, text);
});

test("the outline slug is the Rust slug", () => {
  assert.equal(readyCore().outlineOf("## 2.1 Results (final)")[0]!.slug, readyCore().headingSlug("2.1 Results (final)"));
});

test("the read view's heading id equals the outline slug", () => {
  for (const [text] of FIXTURES.filter(([t]) => t.trim() && t !== "---")) {
    const html = renderProseMarkdown(`## ${text}`);
    const id = /<h\d id="([^"]*)"/.exec(html)?.[1];
    assert.equal(id, readyCore().outlineOf(`## ${text}`)[0]!.slug, text);
  }
});