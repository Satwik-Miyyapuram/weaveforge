/**
 * Recording a copied object in `blob_objects`.
 *
 * The registry is how the app finds the object afterwards; a copy that is not
 * recorded is a copy the app cannot serve. That holds for an object a previous,
 * interrupted run already uploaded too, so a skipped upload is still recorded.
 */

/** Upsert the row for `path` in `bucket`, stored on `tier` at `sizeBytes`. */
export async function registerBlob(db, { bucket, path, tier, sizeBytes }) {
  await db.query(
    `insert into blob_objects (user_id, bucket, path, tier, size_bytes)
     values (
       coalesce(nullif(split_part($1, '/', 1), '')::uuid, (select id from auth.users limit 1)),
       $2, $3, $4, $5
     )
     on conflict (bucket, path) do update set tier = excluded.tier, size_bytes = excluded.size_bytes`,
    [path, bucket, path, tier, sizeBytes],
  );
}
