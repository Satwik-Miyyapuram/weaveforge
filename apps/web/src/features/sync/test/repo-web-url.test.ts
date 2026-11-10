/**
 * An experiment's repo URL is user data rendered as `<a href>`: only http(s)
 * may become a link, so `javascript:` and friends never run on click.
 */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readyCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

before(loadTestCore);

test("http and https repo URLs pass through", () => {
  assert.equal(readyCore().repoWebUrl("https://github.com/a/b"), "https://github.com/a/b");
  assert.equal(readyCore().repoWebUrl("http://gitlab.example.org/a/b.git"), "http://gitlab.example.org/a/b.git");
});

test("script and other schemes are refused", () => {
  for (const bad of ["javascript:alert(1)", " JavaScript:alert(1)", "data:text/html,x", "vbscript:x", "file:///etc/passwd", "git@github.com:a/b.git", "", "not a url"]) {
    assert.equal(readyCore().repoWebUrl(bad), undefined, bad);
  }
  assert.equal(readyCore().repoWebUrl(undefined), undefined);
});

test("commitUrl builds nothing from an unsafe repo URL", () => {
  assert.equal(readyCore().commitUrl("javascript:alert(1)//", "abc123"), undefined);
  assert.equal(readyCore().commitUrl("https://github.com/a/b.git", "abc123"), "https://github.com/a/b/commit/abc123");
  assert.equal(readyCore().commitUrl("https://gitlab.com/a/b/", "abc123"), "https://gitlab.com/a/b/-/commit/abc123");
});

test("experiment screens never put the raw repoUrl in an href", () => {
  for (const file of ["../../experiments/ui/experiment-detail-screen.tsx", "../../experiments/ui/experiment-panels.tsx"]) {
    const text = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(text, /href=\{exp\.repoUrl\}/, file);
  }
});
