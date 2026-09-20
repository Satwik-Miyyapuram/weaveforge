import { test } from "node:test";
import assert from "node:assert/strict";

import {
  appOriginFrom,
  DEFAULT_APP_ORIGIN,
  PITCH_DESCRIPTION,
  PITCH_TITLE,
  pitchShareMetadata,
} from "../share-card";

/**
 * The link-preview card, and the rule that keeps it from drifting.
 *
 * Two hosts serve this page: the exported site (`apps/pitch`, at the root of its
 * own domain) and the app itself (`/pitch`, which `app-shell.tsx` lets through
 * before the auth gate). Both build their metadata from `pitchShareMetadata`,
 * so the card a visitor sees is one card rather than two copies that agree
 * today. These assertions are the guarantee — they are what fails when someone
 * hand-writes a second `openGraph` block.
 */

/** The exported site: no path prefix, root of its own domain. */
const SITE = pitchShareMetadata({ origin: "https://www.weaveforge.org" });
/** The app: same card, one segment in, on whatever origin it is deployed to. */
const APP = pitchShareMetadata({ origin: DEFAULT_APP_ORIGIN, path: "/pitch" });

/** `openGraph` is a union in Next's types; the builder only ever makes this shape. */
function og(meta: typeof SITE) {
  const value = meta.openGraph as
    | { type?: string; siteName?: string; url?: string; title?: string; description?: string; images?: Array<{ url: string; width?: number; height?: number; alt?: string }> }
    | undefined;
  assert.ok(value, "openGraph block is missing");
  return value;
}

function twitter(meta: typeof SITE) {
  const value = meta.twitter as { card?: string; title?: string; description?: string; images?: string[] } | undefined;
  assert.ok(value, "twitter block is missing");
  return value;
}

test("both hosts carry the same title and description", () => {
  // Pinned against the exported strings, not against each other: comparing the
  // two hosts alone would pass if both drifted to the same wrong copy.
  for (const meta of [SITE, APP]) {
    assert.equal(meta.title, PITCH_TITLE);
    assert.equal(meta.description, PITCH_DESCRIPTION);
    assert.equal(og(meta).title, PITCH_TITLE);
    assert.equal(og(meta).description, PITCH_DESCRIPTION);
    assert.equal(twitter(meta).title, PITCH_TITLE);
    assert.equal(twitter(meta).description, PITCH_DESCRIPTION);
  }
});

test("metadataBase is the absolute origin, so a relative image resolves", () => {
  // Without this Next has nothing to resolve `og.png` against, warns, and most
  // crawlers drop the image — a card with no picture, which is the failure the
  // card exists to prevent.
  assert.equal(SITE.metadataBase?.toString(), "https://www.weaveforge.org/");
  assert.equal(APP.metadataBase?.toString(), `${DEFAULT_APP_ORIGIN}/`);
});

test("the card is a large-image one, on both hosts", () => {
  for (const meta of [SITE, APP]) {
    assert.equal(og(meta).type, "website");
    assert.equal(og(meta).siteName, "WeaveForge");
    assert.equal(twitter(meta).card, "summary_large_image");
  }
});

test("the image is 1200x630 and named in both blocks", () => {
  for (const meta of [SITE, APP]) {
    const images = og(meta).images;
    assert.equal(images?.length, 1);
    assert.equal(images?.[0]?.url, "/og.png");
    assert.equal(images?.[0]?.width, 1200);
    assert.equal(images?.[0]?.height, 630);
    assert.deepEqual(twitter(meta).images, ["/og.png"]);
  }
});

test("a base path prefixes the asset and the page, and nothing else", () => {
  // GitHub Pages serves a project site from `/<repo>/`, and a card that points
  // at the domain root there is a card with a 404 in it.
  const prefixed = pitchShareMetadata({
    origin: "https://example.github.io",
    basePath: "/weaveforge",
  });
  assert.equal(og(prefixed).images?.[0]?.url, "/weaveforge/og.png");
  assert.equal(og(prefixed).url, "/weaveforge/");
  assert.deepEqual(twitter(prefixed).images, ["/weaveforge/og.png"]);
  // The base is still the domain: `metadataBase` and `basePath` are different
  // jobs, and folding one into the other is how the URL ends up doubled.
  assert.equal(prefixed.metadataBase?.toString(), "https://example.github.io/");
});

test("each host names its own page", () => {
  assert.equal(og(SITE).url, "/");
  assert.equal(og(APP).url, "/pitch");
});

test("an unset origin means the shipped deployment", () => {
  assert.equal(appOriginFrom(undefined), DEFAULT_APP_ORIGIN);
  assert.equal(appOriginFrom(""), DEFAULT_APP_ORIGIN);
});

test("a self-hosted deployment gets a card naming its own host", () => {
  assert.equal(appOriginFrom("https://research.example.edu"), "https://research.example.edu");
  assert.equal(appOriginFrom("http://localhost:3000"), "http://localhost:3000");
  // Only the origin: a path here would be a base the image is resolved against
  // twice.
  assert.equal(appOriginFrom("https://research.example.edu/pitch"), "https://research.example.edu");
});

test("a value that is not an absolute http(s) URL is ignored, not honoured", () => {
  // This runs at build time. A bare path — the shape the pitch's own `links.ts`
  // falls back to — makes `new URL()` throw, and failing a build over a link
  // preview is the wrong trade.
  for (const bad of ["/", "/pitch", "not a url", "app.example.org", "ftp://example.org", "file:///etc/passwd"]) {
    assert.equal(appOriginFrom(bad), DEFAULT_APP_ORIGIN, `${bad} should fall back`);
  }
});
