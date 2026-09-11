/**
 * The weights cache.
 *
 * The download itself is Electron's `net`, which is not here, so what is
 * tested is the part that decides where a file lands: a renderer composes
 * these URLs, and a URL that could name a path outside the cache directory
 * would be choosing where the shell writes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { cachePathFor, serveModelFile, type FetchLike } from "../src/model-cache";

const ROOT = path.join("C:", "cache", "models");

test("model cache: a repository path becomes a file under the cache root", () => {
  const at = cachePathFor(ROOT, "app://models/Xenova/all-MiniLM-L6-v2/resolve/main/config.json");

  assert.equal(at, path.join(ROOT, "Xenova", "all-MiniLM-L6-v2", "resolve", "main", "config.json"));
});

test("model cache: traversal cannot reach outside the cache directory", () => {
  // A plain `..` is resolved away by the URL itself before it is ever seen.
  assert.equal(cachePathFor(ROOT, "app://models/../../secrets.txt"), path.join(ROOT, "secrets.txt"));
  // An encoded one survives that, and is what the check is actually for.
  assert.equal(cachePathFor(ROOT, "app://models/a%2F..%2F..%2Fb"), null);
});

test("model cache: a request for nothing in particular is refused", () => {
  assert.equal(cachePathFor(ROOT, "app://models/"), null);
});

// -------------------------------------------------------------- the response

const URL_UNDER_TEST = "app://models/Xenova/all-MiniLM-L6-v2/resolve/main/config.json";

async function cacheRoot(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "weaveforge-models-"));
}

/** An upstream that answers with what the test scripted, recording each ask. */
function upstream(script: (url: string, asked: number) => Response) {
  const asked: string[] = [];
  const fetchLike: FetchLike = async (url) => {
    asked.push(url);
    return script(url, asked.length);
  };
  return { fetchLike, asked };
}

test("model cache: what it serves carries no CORS header at all", async () => {
  const root = await cacheRoot();
  const scripted = upstream(() => new Response("weights", { status: 200 }));

  const answer = await serveModelFile(root, URL_UNDER_TEST, scripted.fetchLike);

  assert.equal(answer.status, 200);
  assert.equal(await answer.text(), "weights");
  // The finding: this used to be `*`, which lets any page in any frame read the
  // encoder's weights and config through this app. The renderer fetches
  // `app://` same-origin, where CORS is not consulted, and nothing else asks.
  assert.equal(answer.headers.get("access-control-allow-origin"), null);
  assert.equal(answer.headers.get("content-type"), "application/json");
});

test("model cache: a cached file is served the same way, headers included", async () => {
  const root = await cacheRoot();
  const scripted = upstream(() => new Response("weights", { status: 200 }));
  await serveModelFile(root, URL_UNDER_TEST, scripted.fetchLike);

  // A real read from the disk this time, which is the path a second ask takes.
  const cached = await serveModelFile(root, URL_UNDER_TEST, async () => {
    throw new Error("the cache should have answered without an upstream call");
  });

  assert.equal(cached.status, 200);
  assert.equal(await cached.text(), "weights");
  assert.equal(cached.headers.get("access-control-allow-origin"), null);
});

test("model cache: a redirect on the same host is followed, and only so far", async () => {
  const root = await cacheRoot();
  const scripted = upstream((url, asked) =>
    asked === 1
      ? new Response(null, { status: 302, headers: { location: "/cdn/config.json" } })
      : new Response("weights", { status: 200 }),
  );

  const answer = await serveModelFile(root, URL_UNDER_TEST, scripted.fetchLike);

  assert.equal(answer.status, 200);
  assert.deepEqual(scripted.asked, [
    "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/config.json",
    "https://huggingface.co/cdn/config.json",
  ]);
});

test("model cache: a redirect that leaves the upstream host is refused, not followed", async () => {
  const root = await cacheRoot();
  const scripted = upstream(
    () => new Response(null, { status: 302, headers: { location: "https://evil.example/weights.onnx" } }),
  );

  const answer = await serveModelFile(root, URL_UNDER_TEST, scripted.fetchLike);

  assert.equal(answer.status, 502);
  assert.equal(scripted.asked.length, 1, "the second host must never be asked");
});

test("model cache: a chain of redirects ends, rather than following forever", async () => {
  const root = await cacheRoot();
  let n = 0;
  const scripted = upstream(() => {
    n += 1;
    return new Response(null, { status: 302, headers: { location: `/hop-${n}.json` } });
  });

  const answer = await serveModelFile(root, URL_UNDER_TEST, scripted.fetchLike);

  assert.equal(answer.status, 502);
  // Bounded: the original followed whatever it was handed, with no ceiling.
  assert.equal(scripted.asked.length, 4);
});

test("model cache: an upstream that never answers is a 502, not a throw", async () => {
  const root = await cacheRoot();
  const answer = await serveModelFile(root, URL_UNDER_TEST, async () => {
    throw new Error("ENOTFOUND");
  });

  assert.equal(answer.status, 502);
});

test("model cache: a failed download leaves no half file behind", async () => {
  const root = await cacheRoot();
  const scripted = upstream(() => new Response(null, { status: 404 }));

  const answer = await serveModelFile(root, URL_UNDER_TEST, scripted.fetchLike);

  assert.equal(answer.status, 404);
  // The directory is created only once there are bytes to write, so a refusal
  // leaves nothing at all rather than a `.part` a later read would trust.
  assert.deepEqual(await readdir(root), []);
});
