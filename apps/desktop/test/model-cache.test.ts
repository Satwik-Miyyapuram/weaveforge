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

import { cachePathFor, isUpstreamHost, serveModelFile, type FetchLike } from "../src/model-cache";

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

/**
 * Redirects are followed by `fetch`, and this pins that it is asked to.
 *
 * These tests used to assert a hand-walked chain — that the second hop was asked
 * at `https://huggingface.co/cdn/config.json`, that a hop off the host returned
 * 502, that a chain of four ended. All of it passed, and none of it described
 * what happened in the app, because **Electron's `net.fetch` throws
 * `Error: Redirect was cancelled` when given `redirect: "manual"`**. The walk
 * therefore threw on the first hop, `serveModelFile` answered 502, and the whole
 * feature was unfetchable — while these tests stayed green against an injected
 * fetch that politely returned the 302.
 *
 * Measured under Electron directly:
 *
 *     manual → THREW Error: Redirect was cancelled
 *     follow → 200  ok=true
 *
 * So what is worth asserting now is the *contract*: one request, to the composed
 * target, with following enabled. A redirect policy this process cannot enforce
 * is not a policy, and pretending otherwise is what hid the bug.
 */
test("model cache: it asks once, for the composed target, and lets fetch follow redirects", async () => {
  const root = await cacheRoot();
  const seen: Array<{ url: string; redirect?: string }> = [];
  const fetchLike: FetchLike = async (url, init) => {
    seen.push({ url, redirect: init?.redirect });
    return new Response("weights", { status: 200 });
  };

  const answer = await serveModelFile(root, URL_UNDER_TEST, fetchLike);

  assert.equal(answer.status, 200);
  assert.equal(await answer.text(), "weights");
  assert.deepEqual(seen, [
    {
      url: "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/config.json",
      redirect: "follow",
    },
  ]);
});

test("model cache: the renderer cannot point the download at another host", async () => {
  // The initial target is composed from `UPSTREAM` plus the requested *path*.
  // A URL naming a different host is a renderer choosing where this process makes
  // a request, which is the one thing that has to stay impossible even though
  // redirects are now followed for us.
  const root = await cacheRoot();
  const seen: string[] = [];
  const fetchLike: FetchLike = async (url) => {
    seen.push(url);
    return new Response("weights", { status: 200 });
  };

  await serveModelFile(root, "app://models/anything", fetchLike);

  assert.deepEqual(seen, ["https://huggingface.co/anything"]);
});

/**
 * The host family, which is what keeps the *initial* target honest.
 *
 * It used to police redirect hops too; that is `net.fetch`'s business now (see
 * `serveModelFile`), so this is the remaining job — and it is still a job,
 * because the target is composed here from a path the renderer supplies.
 *
 * The rule is a suffix rule because the LFS CDN is a different `hf.co` subdomain
 * per region. A lookalike that merely *contains* the name must not pass, or the
 * rule becomes a substring check an attacker can satisfy.
 */
test("model cache: the host family is Hugging Face's own, and nothing else", () => {
  for (const host of ["huggingface.co", "cdn-lfs.huggingface.co", "hf.co", "us.aws.cdn.hf.co"]) {
    assert.equal(isUpstreamHost(host), true, `${host} should be allowed`);
  }
  for (const host of [
    "evil.example",
    "huggingface.co.evil.example",
    "nothuggingface.co",
    "hf.co.evil.example",
    "evil-hf.co",
    "",
  ]) {
    assert.equal(isUpstreamHost(host), false, `${host} should be refused`);
  }
});

test("model cache: a redirect is not this code's to police, and it does not pretend to be", async () => {
  /*
   * This replaced a test asserting that a four-hop chain was cut off at four.
   *
   * That ceiling existed because the walk was ours. It cannot be any more:
   * Electron's `net.fetch` throws on `redirect: "manual"`, so the hops are
   * followed inside Chromium and this code never sees one. Keeping the old test
   * would have meant keeping a claim about behaviour that no longer happens —
   * which is exactly how the redirect bugs survived this long.
   *
   * What is asserted instead is the part still owned here: a non-ok answer with
   * no redirect following it is passed on as its own status rather than being
   * flattened into a 502, so a 404 and a gateway failure stay distinguishable.
   */
  const root = await cacheRoot();
  const scripted = upstream(() => new Response(null, { status: 404 }));

  const answer = await serveModelFile(root, URL_UNDER_TEST, scripted.fetchLike);

  assert.equal(answer.status, 404);
  assert.equal(scripted.asked.length, 1, "asked once; following is not this code's job");
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
