import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { withPgUser, PgRunner } from "../pg-runner";
import { resetPgPoolForTests } from "../pool";

describe("PgRunner", () => {
  it("exports withPgUser helper", () => {
    assert.equal(typeof withPgUser, "function");
    assert.equal(typeof PgRunner, "function");
    resetPgPoolForTests();
  });
});
