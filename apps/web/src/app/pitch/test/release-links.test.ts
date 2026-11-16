import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Download links point at GitHub's latest release, which is 0.9.1. */

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), "utf8");

test("links.ts exports RELEASES_URL as the GitHub latest-release page", () => {
  assert.match(read("links.ts"), /export const RELEASES_URL = `\$\{REPO_URL\}\/releases\/latest`/);
});

test("the outro offers the download through RELEASES_URL", () => {
  const page = read("page.tsx");
  assert.match(page, /RELEASES_URL/);
  assert.match(page, /Get 0\.9\.1 from <a href=\{RELEASES_URL\}>/);
});
