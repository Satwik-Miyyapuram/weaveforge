import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { engineStartParams, LOCAL_DB_SHARED_BUFFERS } from "../src/local-db-engine-params";

describe("local-db-engine-params", () => {
  it("keeps every default in order, ends with -c shared_buffers=32MB, and does not mutate input", () => {
    const defaults = Object.freeze(["-X", "custom", "--debug"]);
    const result = engineStartParams(defaults);

    assert.deepEqual(result.slice(0, defaults.length), ["-X", "custom", "--debug"]);
    assert.deepEqual(result.slice(-2), ["-c", `shared_buffers=${LOCAL_DB_SHARED_BUFFERS}`]);
    assert.equal(result.slice(-1)[0], "shared_buffers=32MB");
    assert.equal(result.length, defaults.length + 2);
    assert.notEqual(result, defaults);
    assert.deepEqual(defaults, ["-X", "custom", "--debug"]);
  });

  it("applies shared_buffers=32MB to an in-memory engine and round trips a row", async () => {
    const client = await PGlite.create({
      startParams: engineStartParams(PGlite.defaultStartParams),
    });
    try {
      const buffers = await client.query<{ shared_buffers: string }>("show shared_buffers");
      assert.equal(buffers.rows[0]?.shared_buffers, "32MB");

      await client.exec("create table test_roundtrip (id integer primary key, value text);");
      await client.query("insert into test_roundtrip (id, value) values ($1, $2);", [1, "roundtrip"]);
      const res = await client.query<{ id: number; value: string }>("select id, value from test_roundtrip;");
      assert.deepEqual(res.rows, [{ id: 1, value: "roundtrip" }]);
    } finally {
      await client.close();
    }
  });
});
