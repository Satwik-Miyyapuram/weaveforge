import assert from "node:assert/strict";
import { test } from "node:test";

import { demoUrl } from "../user-docs.mjs";

const PROD = "https://demo.weaveforge.org/";
const LOCAL = "http://127.0.0.1:4174/";

test("demoUrl defaults to the production demo", () => {
  assert.equal(demoUrl({}, []), PROD);
});

test("demoUrl --local points the frames at the local demo server", () => {
  assert.equal(demoUrl({}, ["--local"]), LOCAL);
});

test("DOCS_DEMO_URL overrides both defaults", () => {
  assert.equal(demoUrl({ DOCS_DEMO_URL: "https://staging.example.test/" }, []), "https://staging.example.test/");
  assert.equal(demoUrl({ DOCS_DEMO_URL: "https://staging.example.test/" }, ["--local"]), "https://staging.example.test/");
});

test("demoUrl rejects a value that is not an http(s) URL", () => {
  assert.throws(() => demoUrl({ DOCS_DEMO_URL: "demo.weaveforge.org" }, []), /DOCS_DEMO_URL/);
  assert.throws(() => demoUrl({ DOCS_DEMO_URL: "javascript:alert(1)" }, []), /DOCS_DEMO_URL/);
});
