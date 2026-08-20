import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchPageTitle, fetchRemoteImage } from "../fetch-for-paste";

/** A resolver with one public host, so no DNS is needed. */
const resolve = async (hostname: string): Promise<string[]> => {
  if (hostname === "example.com") return ["93.184.216.34"];
  throw new Error("no such host");
};

function stub(handler: () => Response) {
  const original = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(handler())) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("reads the title a site would want shown for a link", async () => {
  const restore = stub(
    () =>
      new Response("<html><head><title>Obsidian - Sharpen your thinking</title></head></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
  );
  try {
    const result = await fetchPageTitle("https://example.com/", { resolve });
    assert.equal(result.ok, true);
    assert.equal(result.ok === true && result.title, "Obsidian - Sharpen your thinking");
  } finally {
    restore();
  }
});

test("a challenge page is refused rather than used as a title", async () => {
  const restore = stub(
    () => new Response("<title>Just a moment...</title>", { headers: { "content-type": "text/html" } }),
  );
  try {
    const result = await fetchPageTitle("https://example.com/", { resolve });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.status, 403);
  } finally {
    restore();
  }
});

test("something that is not a web page has no title to read", async () => {
  const restore = stub(() => new Response("%PDF-1.7", { headers: { "content-type": "application/pdf" } }));
  try {
    const result = await fetchPageTitle("https://example.com/p.pdf", { resolve });
    assert.equal(result.ok === false && result.status, 415);
  } finally {
    restore();
  }
});

test("a page with no title at all says so", async () => {
  const restore = stub(() => new Response("<html><body>hi</body></html>", { headers: { "content-type": "text/html" } }));
  try {
    const result = await fetchPageTitle("https://example.com/", { resolve });
    assert.equal(result.ok === false && result.status, 404);
  } finally {
    restore();
  }
});

test("a private address is refused before any request", async () => {
  const restore = stub(() => new Response("should not happen"));
  try {
    for (const target of ["http://169.254.169.254/", "http://127.0.0.1/", "http://localhost/"]) {
      const result = await fetchPageTitle(target, { resolve });
      assert.equal(result.ok, false, target);
      assert.equal(result.ok === false && result.status, 400, target);
    }
  } finally {
    restore();
  }
});

test("an image comes back with the type its server declared", async () => {
  const bytes = new Uint8Array([137, 80, 78, 71]);
  const restore = stub(() => new Response(bytes, { headers: { "content-type": "image/png" } }));
  try {
    const result = await fetchRemoteImage("https://example.com/fig.png", { resolve });
    assert.equal(result.ok, true);
    assert.equal(result.ok === true && result.contentType, "image/png");
    assert.deepEqual(result.ok === true && result.body, bytes);
  } finally {
    restore();
  }
});

test("a declared type that is not an image is refused rather than sniffed", async () => {
  // A server that echoes whatever it is sent, served back through our own
  // origin, is a stored-XSS delivery mechanism.
  for (const type of ["text/html", "image/svg+xml", "application/octet-stream"]) {
    const restore = stub(() => new Response("<script>alert(1)</script>", { headers: { "content-type": type } }));
    try {
      const result = await fetchRemoteImage("https://example.com/x.png", { resolve });
      assert.equal(result.ok, false, type);
      assert.equal(result.ok === false && result.status, 415, type);
    } finally {
      restore();
    }
  }
});

test("an upstream failure keeps its meaning", async () => {
  const restore = stub(() => new Response("nope", { status: 404 }));
  try {
    const result = await fetchPageTitle("https://example.com/gone", { resolve });
    assert.equal(result.ok === false && result.status, 404);
  } finally {
    restore();
  }
});
