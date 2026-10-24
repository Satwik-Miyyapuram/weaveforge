/**
 * One heading slug for the read view's ids and the outline's links (13-06,
 * 28-23, xhelp-11). Saved `[[Note#Heading]]` links and TOC clicks depend on
 * these exact strings, so the fixtures are pinned.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { renderProseMarkdown } from "@/components/markdown/markdown";
import { headingSlug as outlineSlug, outlineOf } from "@/features/editor-workspace/application/outline";
import { headingSlug } from "@/lib/heading-slug";

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
  for (const [text, slug] of FIXTURES) assert.equal(headingSlug(text), slug, text);
});

test("the outline uses the same slug function", () => {
  assert.equal(outlineSlug, headingSlug);
  assert.equal(outlineOf("## 2.1 Results (final)")[0]!.slug, "2-1-results-final");
});

test("the read view's heading id equals the outline slug", () => {
  for (const [text] of FIXTURES.filter(([t]) => t.trim() && t !== "---")) {
    const html = renderProseMarkdown(`## ${text}`);
    const id = /<h\d id="([^"]*)"/.exec(html)?.[1];
    assert.equal(id, outlineOf(`## ${text}`)[0]!.slug, text);
  }
});
