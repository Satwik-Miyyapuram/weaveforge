/**
 * `blob_objects` has `id uuid primary key` and `unique (bucket, path)`
 * (migration 0023). An upsert that names no conflict target resolves on the
 * primary key, so registering a path that is already there is a unique
 * violation, raised after the bytes are already in the bucket (10-01).
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { PostgrestBlobRegistry } from "../providers/postgrest/blob-registry";

type Row = Record<string, unknown> & { id: string; bucket: string; path: string };

/** The table as PostgREST sees it: a uuid key and a unique (bucket, path). */
function fakeTable() {
  const table: Row[] = [];
  let next = 0;
  const db = {
    from(name: string) {
      assert.equal(name, "blob_objects");
      return {
        async upsert(values: Record<string, unknown>, options?: { onConflict?: string }) {
          const target = options?.onConflict ?? "id";
          const existing =
            target === "bucket,path"
              ? table.find((r) => r.bucket === values.bucket && r.path === values.path)
              : table.find((r) => r.id === values.id);
          if (existing) {
            Object.assign(existing, values);
            return { data: null, error: null };
          }
          if (table.some((r) => r.bucket === values.bucket && r.path === values.path)) {
            return {
              data: null,
              error: { code: "23505", message: 'duplicate key value violates unique constraint "blob_objects_bucket_path_key"' },
            };
          }
          table.push({ ...values, id: `id-${(next += 1)}` } as Row);
          return { data: null, error: null };
        },
      };
    },
  };
  return { table, db: db as unknown as SupabaseClient };
}

test("registering the same path twice keeps one row, with the newer size (10-01)", async () => {
  const { table, db } = fakeTable();
  const registry = new PostgrestBlobRegistry(db);

  await registry.register({ bucket: "ink", path: "u1/p1/chunk-0", sizeBytes: 10 });
  await registry.register({ bucket: "ink", path: "u1/p1/chunk-0", sizeBytes: 25 });

  assert.equal(table.length, 1);
  assert.equal(table[0]!.size_bytes, 25);
});

test("the same path in another bucket is its own row (10-01)", async () => {
  const { table, db } = fakeTable();
  const registry = new PostgrestBlobRegistry(db);

  await registry.register({ bucket: "ink", path: "u1/a.png", sizeBytes: 1 });
  await registry.register({ bucket: "showcase", path: "u1/a.png", sizeBytes: 2 });

  assert.equal(table.length, 2);
});

test("a re-register keeps the tier and priority it is given (10-01)", async () => {
  const { table, db } = fakeTable();
  const registry = new PostgrestBlobRegistry(db);

  await registry.register({ bucket: "b", path: "p", sizeBytes: 1 });
  await registry.register({ bucket: "b", path: "p", sizeBytes: 1, tier: "cold", priority: 90 });

  assert.equal(table.length, 1);
  assert.equal(table[0]!.tier, "cold");
  assert.equal(table[0]!.priority, 90);
});
