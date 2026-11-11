import test, { afterEach, before } from "node:test";
import assert from "node:assert/strict";
import { relayPath, relayUrl } from "../parts";
import { originalUrlFromProxy, proxiedPdfUrl } from "@/features/reader/application/sanitize-reader-url";
import { semanticScholarUrl } from "../semantic-scholar-fetch";
import { loadTestCore } from "@/lib/test/load-test-core";

before(loadTestCore);

/**
 * The hosted page reaches the relay routes on the axum relay when
 * NEXT_PUBLIC_RELAY_URL is set; the shells keep their in-process relay, and an
 * unset variable keeps the Next routes on the same origin.
 */

const RELAY = "https://api.weaveforge.org/relay";
const g = globalThis as { window?: unknown };

function inBrowser() {
  g.window = {};
}

function inShell() {
  g.window = { weaveforge: { fetchTitle: () => undefined } };
}

afterEach(() => {
  delete process.env.NEXT_PUBLIC_RELAY_URL;
  delete g.window;
});

test("unset keeps the same-origin path", () => {
  inBrowser();
  assert.equal(relayUrl("/api/arxiv"), "/api/arxiv");
  assert.equal(relayPath("/api/arxiv"), "/api/arxiv");
});

test("a browser with a relay URL goes to the relay, trailing slashes dropped", () => {
  inBrowser();
  process.env.NEXT_PUBLIC_RELAY_URL = ` ${RELAY}// `;
  assert.equal(relayUrl("/api/arxiv"), `${RELAY}/api/arxiv`);
});

test("a blank relay URL counts as unset", () => {
  inBrowser();
  process.env.NEXT_PUBLIC_RELAY_URL = "   ";
  assert.equal(relayUrl("/api/arxiv"), "/api/arxiv");
});

test("the shell keeps its in-process relay", () => {
  inShell();
  process.env.NEXT_PUBLIC_RELAY_URL = RELAY;
  assert.equal(relayUrl("/api/arxiv"), "/api/arxiv");
  assert.equal(relayPath(`${RELAY}/api/arxiv`), `${RELAY}/api/arxiv`);
});

test("relayPath strips the relay base and leaves anything else alone", () => {
  inBrowser();
  process.env.NEXT_PUBLIC_RELAY_URL = RELAY;
  assert.equal(relayPath(`${RELAY}/api/pdf-proxy?url=x`), "/api/pdf-proxy?url=x");
  assert.equal(relayPath(`${RELAY}evil/api/pdf-proxy?url=x`), `${RELAY}evil/api/pdf-proxy?url=x`);
  assert.equal(relayPath("https://example.org/a.pdf"), "https://example.org/a.pdf");
});

test("a proxied PDF goes through the relay and round-trips", () => {
  inBrowser();
  process.env.NEXT_PUBLIC_RELAY_URL = RELAY;
  const original = "https://arxiv.org/pdf/2301.00001";
  const proxied = proxiedPdfUrl(original);
  assert.ok(proxied.startsWith(`${RELAY}/api/pdf-proxy?url=`));
  assert.equal(originalUrlFromProxy(proxied), original);
});

test("Semantic Scholar goes through the relay in a browser", () => {
  inBrowser();
  process.env.NEXT_PUBLIC_RELAY_URL = RELAY;
  assert.equal(semanticScholarUrl("graph/v1"), `${RELAY}/api/semantic-scholar/graph/v1`);
});
