import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { ApiKeysNotInBrowserError, RefusingSecretsStore } from "../refusing-secrets-store";

describe("refusing secrets store (browser build, no keychain)", () => {
  const realFetch = globalThis.fetch;
  let fetchCalls = 0;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function spyFetch(): void {
    fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("network must not be used for API keys");
    }) as typeof fetch;
  }

  it("load returns no keys and makes no network call", async () => {
    spyFetch();
    const secrets = await new RefusingSecretsStore().load();
    assert.equal(secrets.zoteroApiKey ?? "", "");
    assert.equal(secrets.semanticScholarKey ?? "", "");
    assert.equal(fetchCalls, 0);
  });

  it("save refuses with a typed error and never reaches the network or a file", async () => {
    spyFetch();
    const store = new RefusingSecretsStore();
    await assert.rejects(
      () => store.save({ zoteroApiKey: "zk-123" }),
      (error: unknown) =>
        error instanceof ApiKeysNotInBrowserError &&
        error.name === "ApiKeysNotInBrowserError" &&
        error.message === "API keys can't be saved in the browser in this version",
    );
    assert.equal(fetchCalls, 0);
  });
});
