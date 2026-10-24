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

test("sweeps the storage prefix in every blob bucket", async () => {
  const { BLOB_STORAGE_BUCKETS } = await import("@/storage/server/blob-access");
  const { purgeUserBlobs } = await import("../purge-user-blobs");
  const listed: string[] = [];
  const admin = fakeAdmin();
  admin.storage.from = ((bucket: string) => ({
    list: async () => {
      listed.push(bucket);
      return { data: [], error: null };
    },
    remove: async () => ({ error: null }),
  })) as never;
  await purgeUserBlobs(admin as never, "u1", () => fakeStore as never);
  assert.deepEqual(listed, [...BLOB_STORAGE_BUCKETS]);
});

test("a storage remove error stops the purge and keeps the registry (09-01)", async () => {
  const { purgeUserBlobs } = await import("../purge-user-blobs");
  const admin = fakeAdmin();
  admin.storage.from = (() => ({
    list: async (prefix: string) => ({
      data: prefix === "u1" ? [{ name: "a.webp", id: "x" }] : [],
      error: null,
    }),
    remove: async () => ({ error: new Error("remove failed") }),
  })) as never;
  await assert.rejects(purgeUserBlobs(admin as never, "u1", () => fakeStore as never), /remove failed/);
  assert.equal(state.registryCleared, false);
});

test("a registry delete error is reported, not swallowed (09-01)", async () => {
  const { purgeUserBlobs } = await import("../purge-user-blobs");
  const admin = fakeAdmin();
  const base = admin.from;
  admin.from = ((table: string) => ({
    ...base(table),
    delete: () => ({ eq: async () => ({ error: new Error("registry delete failed") }) }),
  })) as never;
  await assert.rejects(
    purgeUserBlobs(admin as never, "u1", () => fakeStore as never),
    /registry delete failed/,
  );
});

test("pages through a prefix longer than one listing and removes every object (09-02)", async () => {
  const { purgeUserBlobs } = await import("../purge-user-blobs");
  const all = Array.from({ length: 450 }, (_, i) => ({ name: `f${i}.bin`, id: `id${i}` }));
  const removedPaths: string[] = [];
  const admin = fakeAdmin();
  admin.storage.from = ((bucket: string) => ({
    list: async (prefix: string, opts: { limit: number; offset?: number }) => {
      if (bucket !== "paper-images" || prefix !== "u1") return { data: [], error: null };
      const from = opts.offset ?? 0;
      return { data: all.slice(from, from + opts.limit), error: null };
    },
    remove: async (paths: string[]) => {
      removedPaths.push(...paths);
      return { error: null };
    },
  })) as never;
  await purgeUserBlobs(admin as never, "u1", () => fakeStore as never);
  assert.equal(new Set(removedPaths).size, 450);
  assert.ok(removedPaths.includes("u1/f449.bin"));
});
