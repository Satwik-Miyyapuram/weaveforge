import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LocalRunner, localRunnerQuery } from "../parts";

describe("the local database runner", () => {
  it("refuses every query: the local database was removed in 0.9.8", async () => {
    await assert.rejects(new LocalRunner().query("select 1 where $1", [true]), /local database removed in 0.9.8/);
  });

  it("refuses queryOne and exec the same way", async () => {
    await assert.rejects(new LocalRunner().queryOne("select 1"), /removed in 0.9.8/);
    await assert.rejects(new LocalRunner().exec("select 1"), /removed in 0.9.8/);
  });

  it("the default query part refuses too", async () => {
    await assert.rejects(localRunnerQuery()("select 1", []), /removed in 0.9.8/);
  });
});