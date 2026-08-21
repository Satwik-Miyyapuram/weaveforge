/**
 * Account deletion's blob purge.
 *
 * This runs immediately before the account row and the auth user are deleted,
 * so the invariant under test is narrow and important: never forget an object
 * that is still in the bucket. The registry is the only index of what a user
 * owns; once it and the auth user are gone, a surviving object is unreachable
 * and unattributable, after the user asked for their data to be deleted.
 */

import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

process.env.NEXT_PUBLIC_BLOB_PROVIDER = "tiered";

const removed: string[] = [];
let removeFails = false;

/** Stands in for the tiered store the purge builds from the registry. */
const fakeStore = {
  remove: async (bucket: string, path: string) => {
    if (removeFails) throw new Error("object storage unreachable");
    removed.push(`${bucket}/${path}`);
  },
};

interface FakeState {
  rows: { bucket: string; path: string }[];
  registryCleared: boolean;
  listError: Error | null;
}
let state: FakeState;

function fakeAdmin() {
  return {
    from(_table: string) {
      return {
        select: () => ({ eq: async () => ({ data: state.rows, error: null }) }),
        delete: () => ({
          eq: async () => {
            state.registryCleared = true;
            return { error: null };
          },
        }),
      };
    },
    storage: {
      from: () => ({
        list: async () => ({ data: [], error: state.listError }),
        remove: async () => ({ error: null }),
      }),
    },
  };
}

beforeEach(() => {
  removed.length = 0;
  removeFails = false;
  state = { rows: [{ bucket: "paper-images", path: "u1/p1/a.webp" }], registryCleared: false, listError: null };
});

async function purge() {
  const { purgeUserBlobs } = await import("../purge-user-blobs");
  return purgeUserBlobs(fakeAdmin() as never, "u1", () => fakeStore as never);
}

test("removes each object, then clears the registry", async () => {
  await purge();

  assert.deepEqual(removed, ["paper-images/u1/p1/a.webp"]);
  assert.equal(state.registryCleared, true);
});

test("keeps the registry and fails loudly when an object cannot be removed", async () => {
  removeFails = true;

  await assert.rejects(purge, /account not deleted/i);

  assert.equal(
    state.registryCleared,
    false,
    "the registry was cleared while an object was still in the bucket",
  );
});

test("a storage listing failure stops the purge instead of reading as an empty bucket", async () => {
  state.listError = new Error("list failed");

  await assert.rejects(purge, /list failed/);

  assert.equal(state.registryCleared, false);
});
