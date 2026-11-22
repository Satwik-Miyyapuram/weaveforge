import assert from "node:assert/strict";
import { test } from "node:test";

import { READ_ONLY_MESSAGE, readOnlyDb } from "../read-only-repositories";

/** A fake client whose storage and schema calls record what reached them. */
function fakeClient(reached: string[]) {
  const bucket = (name: string) => ({
    upload: async () => {
      reached.push(`upload ${name}`);
      return { error: null };
    },
    remove: async () => {
      reached.push(`remove ${name}`);
      return { error: null };
    },
    createSignedUrls: async () => {
      reached.push(`sign ${name}`);
      return { data: [], error: null };
    },
  });
  const schemaClient = {
    from: (table: string) => ({
      insert: async () => {
        reached.push(`insert ${table}`);
        return { error: null };
      },
    }),
  };
  return {
    from: () => ({}),
    rpc: async () => ({}),
    storage: { from: (name: string) => bucket(name) },
    schema: () => schemaClient,
  };
}

test("storage writes to a personal bucket are refused and never reach the client", async () => {
  const reached: string[] = [];
  const db = readOnlyDb(fakeClient(reached));
  await assert.rejects(async () => db.storage.from("paper-images").upload("p1/a.png", new Blob(["x"])), new Error(READ_ONLY_MESSAGE));
  await assert.rejects(async () => db.storage.from("paper-images").remove(["p1/a.png"]), new Error(READ_ONLY_MESSAGE));
  assert.deepEqual(reached, [], "nothing reached the storage client");
});

test("storage reads still pass through", async () => {
  const reached: string[] = [];
  const db = readOnlyDb(fakeClient(reached));
  await db.storage.from("paper-images").createSignedUrls(["p1/a.png"], 60);
  assert.deepEqual(reached, ["sign paper-images"]);
});

test("an allowlisted org bucket still uploads to the server", async () => {
  const reached: string[] = [];
  const db = readOnlyDb(fakeClient(reached), ["org-shared"]);
  await db.storage.from("org-shared").upload("s1/a.png", new Blob(["x"]));
  await assert.rejects(async () => db.storage.from("paper-images").upload("p1/a.png", new Blob(["x"])), new Error(READ_ONLY_MESSAGE));
  assert.deepEqual(reached, ["upload org-shared"]);
});

test("a write through schema() is refused like a write on the root client", async () => {
  const reached: string[] = [];
  const db = readOnlyDb(fakeClient(reached));
  assert.throws(() => db.schema("public").from("projects").insert({}), new Error(READ_ONLY_MESSAGE));
  assert.deepEqual(reached, [], "nothing reached the schema client");
});
