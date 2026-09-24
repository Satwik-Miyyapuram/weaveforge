/**
 * How the collection picker reaches Zotero, per build.
 *
 * Two bugs live here, and the second one was mine.
 *
 * The first: on the desktop build the picker went through
 * `/api/integrations/zotero/collections`, which the export does not contain — so
 * the 404 was read as "no collections" and Settings told a reader with a valid
 * key to check their key. `ZoteroBibliographyIntegration` already has a direct
 * branch; it is only taken when a `fetchFn` is supplied, and production wiring
 * never supplied one.
 *
 * The second: supplying the *raw global* `fetch` made it worse, and silently.
 * `bibliography-integration.ts` calls the function as `this.deps.fetchFn(url,
 * init)`, so the receiver is the deps object. `fetch` is a Window operation that
 * refuses a receiver which is not a Window: it throws `TypeError: Illegal
 * invocation` synchronously, before any request is queued. The picker reported a
 * failure and the network log stayed empty. Node's `fetch` does not enforce that
 * rule, so a naive test passes either way — hence the stub in the last test,
 * which does.
 */
import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import { zoteroCollectionsFetch } from "../providers/zotero/wire-zotero-bibliography";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("the Zotero collection transport", () => {
  it("relays through the route on a deployment that has one", () => {
    // Undefined means "let the integration use the relay", which is what the
    // served web app needs: a normal page origin cannot read Zotero directly.
    assert.equal(zoteroCollectionsFetch(false), undefined);
  });

  it("asks Zotero directly on a deployment that has no routes", () => {
    assert.equal(typeof zoteroCollectionsFetch(true), "function");
  });

  it("survives being called as a property of the object that holds it", async () => {
    // Chrome's rule, reproduced: a `fetch` invoked with a foreign receiver
    // throws before the request is queued. This is the exact call shape
    // `bibliography-integration.ts` uses.
    let called = 0;
    globalThis.fetch = function (this: unknown, ..._args: Parameters<typeof fetch>) {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }
      called += 1;
      return Promise.resolve(new Response("[]", { status: 200 }));
    } as unknown as typeof fetch;

    const deps = { fetchFn: zoteroCollectionsFetch(true) };
    assert.ok(deps.fetchFn, "the offline build must supply one");
    const res = await deps.fetchFn("https://api.zotero.org/users/1/collections?limit=100");

    assert.equal(res.status, 200);
    assert.equal(called, 1, "the request reached the stub rather than throwing first");
  });
});
