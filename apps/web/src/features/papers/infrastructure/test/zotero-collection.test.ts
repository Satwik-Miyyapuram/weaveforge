import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withAppLogs } from "@/lib/error-report/test/capture-app-logs";
import { localZoteroCollection } from "../zotero-collection";

describe("localZoteroCollection", () => {
  const settings = (read: (id: string) => Promise<string | undefined>) => ({ getCollection: read });

  it("reads the project's collection", async () => {
    const read = localZoteroCollection(settings(async (id) => `c-${id}`), () => "p1");
    assert.equal(await read(), "c-p1");
  });

  it("means the whole library with no project, without asking", async () => {
    let asked = false;
    const read = localZoteroCollection(settings(async () => ((asked = true), "c")), () => undefined);
    assert.equal(await read(), undefined);
    assert.equal(asked, false);
  });

  it("falls back to the whole library and logs why (09-17)", async () => {
    await withAppLogs(async (logs) => {
      const read = localZoteroCollection(settings(async () => Promise.reject(new Error("timeout"))), () => "p1");
      assert.equal(await read(), undefined);
      assert.equal(logs.length, 1);
      assert.equal(logs[0]!.level, "warn");
      assert.match(logs[0]!.detail ?? "", /p1.*timeout/);
    });
  });
});
