//! Ports the SQL text and the decisions of the local attachment store in
//! `apps/web/src/backend/providers/local/parts-1.ts`: `LocalBlobStore` (the
//! `local_blobs` table), `LocalFirstBlobStore` (the `local_blob_uploads` queue),
//! the merge of signed links and the missing-path filter. The PGlite queries,
//! the file bridge, base64 decoding of bytes and the logging stay in TypeScript.

use std::collections::HashMap;

/// The statements of the local attachment store, by name. The names are what the
/// wasm shim exposes; an unknown name is `None`.
#[must_use]
pub fn blob_sql(name: &str) -> Option<&'static str> {
    Some(match name {
        "upsertBlob" => {
            "insert into local_blobs (bucket, path, content_type, bytes, on_disk, updated_at) values ($1, $2, $3, $4, $5, now()) on conflict (bucket, path) do update set content_type = excluded.content_type, bytes = excluded.bytes, on_disk = excluded.on_disk, updated_at = now()"
        }
        "deleteBlobReturningOnDisk" => {
            "delete from local_blobs where bucket = $1 and path = $2 returning on_disk"
        }
        "selectUploadOp" => "select op from local_blob_uploads where bucket = $1 and path = $2",
        "deleteUpload" => "delete from local_blob_uploads where bucket = $1 and path = $2",
        "countUploads" => "select count(*)::int as n from local_blob_uploads",
        "selectUploadQueue" => {
            "select bucket, path, op, version from local_blob_uploads order by queued_at"
        }
        "deleteUploadVersion" => {
            "delete from local_blob_uploads where bucket = $1 and path = $2 and version = $3"
        }
        "bumpUploadAttempt" => {
            "update local_blob_uploads set attempts = attempts + 1, last_error = $3 where bucket = $1 and path = $2"
        }
        "enqueueUpload" => {
            "insert into local_blob_uploads (bucket, path, op, attempts, last_error, queued_at) values ($1, $2, $3, 0, null, now()) on conflict (bucket, path) do update set op = excluded.op, version = local_blob_uploads.version + 1, attempts = 0, last_error = null, queued_at = now()"
        }
        _ => return None,
    })
}

/// The statement that reads the rows of a set of paths: `$1` is the bucket, then one
/// placeholder per path. One statement per set, so a grid of images is one call.
#[must_use]
pub fn blob_read_sql(path_count: usize) -> String {
    let holes: Vec<String> = (0..path_count).map(|i| format!("${}", i + 2)).collect();
    format!(
        "select path, content_type, bytes, on_disk from local_blobs where bucket = $1 and path in ({})",
        holes.join(", ")
    )
}

/// Whether a removal forgets a queued upload instead of queueing a remote removal:
/// a picture that never reached the server needs nothing sent.
#[must_use]
pub fn removal_forgets_unsent_upload(pending_op: Option<&str>) -> bool {
    pending_op == Some("upload")
}

/// The paths that are not in `have`, in their original order (`paths.filter((p) => !have.has(p))`).
#[must_use]
pub fn missing_paths(paths: &[String], have: &[String]) -> Vec<String> {
    paths
        .iter()
        .filter(|p| !have.contains(p))
        .cloned()
        .collect()
}

/// The indices whose signed link this computer does not have (`here[i] === null`), in order.
/// Index-based, so the server is asked for `paths[i]` for each returned `i`.
#[must_use]
pub fn unsigned_indices(here: &[Option<String>]) -> Vec<usize> {
    here.iter()
        .enumerate()
        .filter(|(_, url)| url.is_none())
        .map(|(i, _)| i)
        .collect()
}

/// Merges signed links: a link this computer has wins; the rest come from the server's
/// answer for the missing paths, `there`, aligned with [`missing_paths`] of `paths`.
#[must_use]
pub fn merge_signed_urls(
    paths: &[String],
    here: &[Option<String>],
    there: &[Option<String>],
) -> Vec<Option<String>> {
    let missing: Vec<&String> = paths
        .iter()
        .enumerate()
        .filter(|(i, _)| here.get(*i).is_none_or(Option::is_none))
        .map(|(_, p)| p)
        .collect();
    let mut by_path: HashMap<&str, Option<String>> = HashMap::new();
    for (path, url) in missing.iter().zip(there.iter()) {
        let _ = by_path.insert(path.as_str(), url.clone());
    }
    paths
        .iter()
        .enumerate()
        .map(|(i, path)| {
            here.get(i)
                .cloned()
                .flatten()
                .or_else(|| by_path.get(path.as_str()).cloned().flatten())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    // it: "asks the server only for links this computer lacks, by position"
    #[test]
    fn unsigned_indices_are_the_null_positions_in_order() {
        let here = vec![
            Some("local".to_owned()),
            None,
            None,
            Some("also local".to_owned()),
        ];
        assert_eq!(unsigned_indices(&here), vec![1, 2]);
        assert!(unsigned_indices(&[Some("x".to_owned())]).is_empty());
    }

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_owned()).collect()
    }

    // it: "keeps a picture with no network and shows it straight away"
    #[test]
    fn upload_writes_one_upserted_row() {
        let sql = blob_sql("upsertBlob").expect("known name");
        assert!(sql.contains("insert into local_blobs"));
        assert!(sql.contains("on conflict (bucket, path) do update"));
    }

    // it: "keeps a failed send queued with its reason, and retries it"
    #[test]
    fn failed_send_bumps_attempts_and_keeps_reason() {
        let sql = blob_sql("bumpUploadAttempt").expect("known name");
        assert!(sql.contains("attempts = attempts + 1"));
        assert!(sql.contains("last_error = $3"));
    }

    // it: "keeps a queued upload when this computer's copy cannot be read (09-07)"
    #[test]
    fn queue_is_ordered_oldest_first() {
        let sql = blob_sql("selectUploadQueue").expect("known name");
        assert!(sql.ends_with("order by queued_at"));
    }

    // it: "never sends a picture removed before it reached the server"
    #[test]
    fn removing_an_unsent_upload_forgets_it() {
        assert!(removal_forgets_unsent_upload(Some("upload")));
        assert!(!removal_forgets_unsent_upload(Some("remove")));
        assert!(!removal_forgets_unsent_upload(None));
    }

    // it: "removes from the server what the server already had"
    #[test]
    fn removal_of_a_sent_picture_queues_a_remote_removal() {
        assert!(!removal_forgets_unsent_upload(None));
    }

    // it: "asks the server only for what this computer does not have"
    #[test]
    fn only_missing_paths_are_asked_for() {
        let paths = strings(&["a", "b", "c"]);
        let have = strings(&["b"]);
        assert_eq!(missing_paths(&paths, &have), strings(&["a", "c"]));
    }

    // it: "answers from this computer when the server is unreachable"
    #[test]
    fn local_links_are_kept_when_the_server_gives_none() {
        let paths = strings(&["a", "b"]);
        let here = vec![Some("local-a".to_owned()), None];
        let there = vec![None];
        assert_eq!(
            merge_signed_urls(&paths, &here, &there),
            vec![Some("local-a".to_owned()), None]
        );
    }

    // it: "asks the server only for what this computer does not have" (merge half)
    #[test]
    fn server_links_fill_only_the_gaps() {
        let paths = strings(&["a", "b", "c"]);
        let here = vec![Some("local-a".to_owned()), None, None];
        let there = vec![Some("server-b".to_owned()), None];
        assert_eq!(
            merge_signed_urls(&paths, &here, &there),
            vec![
                Some("local-a".to_owned()),
                Some("server-b".to_owned()),
                None
            ]
        );
    }

    #[test]
    fn read_sql_has_one_placeholder_per_path() {
        assert_eq!(
            blob_read_sql(2),
            "select path, content_type, bytes, on_disk from local_blobs where bucket = $1 and path in ($2, $3)"
        );
    }

    #[test]
    fn unknown_sql_name_is_none() {
        assert!(blob_sql("nope").is_none());
    }
}
