//! Ports the decisions and SQL text of `ExperimentPush` in
//! `apps/web/src/backend/providers/local/parts-1.ts`: the metric cursor default,
//! the `app://artifacts/` rewrite to storage paths, the png/jpg to webp naming and
//! the rule for keeping the webp copy. The loops, the server calls, the blob
//! upload, the canvas work and the PGlite queries stay in TypeScript.

/// The prefix of a desktop-local artifact link.
pub const ARTIFACT_PREFIX: &str = "app://artifacts/";

/// The storage bucket the pushed artifacts go to.
pub const ARTIFACT_BUCKET: &str = "experiment-artifacts";

/// How many metric points one push batch sends.
pub const BATCH: u32 = 1000;

/// The cursor a series starts from when nothing was pushed yet: the lowest step.
pub const MIN_STEP: f64 = -2_147_483_648.0;

/// The statements of the experiment push, by name; `None` for an unknown name.
#[must_use]
pub fn push_sql(name: &str) -> Option<String> {
    Some(match name {
        "selectResets" => "select experiment_id from local_metric_resets".to_owned(),
        "deleteReset" => "delete from local_metric_resets where experiment_id = $1".to_owned(),
        "selectSeries" => "select d.experiment_id, d.metric_id, n.name as metric, p.step as pushed from local_metric_dirty d join experiment_metric_names n on n.id = d.metric_id left join local_metric_pushes p on p.experiment_id = d.experiment_id and p.metric = n.name".to_owned(),
        "selectPointsAfter" => format!(
            "select step, value, wall_time from experiment_metric_points where experiment_id = $1 and metric_id = $2 and step > $3 order by step limit {BATCH}"
        ),
        "upsertPushCursor" => "insert into local_metric_pushes (experiment_id, metric, step) values ($1, $2, $3) on conflict (experiment_id, metric) do update set step = excluded.step".to_owned(),
        "deleteDirtyBelowCursor" => "delete from local_metric_dirty d where experiment_id = $1 and metric_id = $2 and not exists (select 1 from experiment_metric_points m where m.experiment_id = d.experiment_id and m.metric_id = d.metric_id and m.step > $3)".to_owned(),
        "selectArtifactRows" => "select id, artifacts from experiments where artifacts::text like '%app://artifacts/%'".to_owned(),
        "updateArtifacts" => "update experiments set artifacts = $2::jsonb where id = $1".to_owned(),
        "selectLocalArtifactsOf" => "select id, artifacts from experiments where artifacts::text like $1".to_owned(),
        _ => return None,
    })
}

/// The cursor to read from: the last pushed step, or [`MIN_STEP`] when nothing was pushed
/// (`pushed ?? -2147483648`).
#[must_use]
pub fn pushed_cursor(pushed: Option<f64>) -> f64 {
    pushed.unwrap_or(MIN_STEP)
}

/// The rest of an `app://artifacts/` entry after the prefix, or `None` when the entry is
/// not one or nothing follows the prefix.
#[must_use]
pub fn artifact_rest(entry: &str) -> Option<&str> {
    entry
        .strip_prefix(ARTIFACT_PREFIX)
        .filter(|rest| !rest.is_empty())
}

/// The file name in storage. A recompressed png/jpg/jpeg becomes `.webp`; anything else
/// keeps its name (`blob === raw ? rest : rest.replace(/\.(png|jpe?g)$/i, ".webp")`).
#[must_use]
pub fn artifact_storage_name(rest: &str, recompressed: bool) -> String {
    if !recompressed {
        return rest.to_owned();
    }
    let lower = rest.to_ascii_lowercase();
    for ext in [".png", ".jpeg", ".jpg"] {
        if lower.ends_with(ext) {
            let stem = &rest[..rest.len() - ext.len()];
            return format!("{stem}.webp");
        }
    }
    rest.to_owned()
}

/// The storage path of a pushed artifact: `{accountId}/{name}`.
#[must_use]
pub fn artifact_storage_path(account_id: &str, name: &str) -> String {
    format!("{account_id}/{name}")
}

/// The LIKE pattern for artifact rows already pointing at this account's storage paths:
/// `%"{accountId}/%` (a JSON string that starts with the account id).
#[must_use]
pub fn account_artifacts_pattern(account_id: &str) -> String {
    format!("%\"{account_id}/%")
}

/// Whether a blob of this media type is recompressed to webp before the push.
#[must_use]
pub fn should_recompress(mime: &str) -> bool {
    mime == "image/png" || mime == "image/jpeg"
}

/// Whether the webp copy is kept: it must be webp and smaller than the original.
#[must_use]
pub fn prefer_webp(webp_mime: &str, webp_size: f64, original_size: f64) -> bool {
    webp_mime == "image/webp" && webp_size < original_size
}

#[cfg(test)]
mod tests {
    use super::*;

    // it: "turns app:// artifacts into storage paths"
    #[test]
    fn artifact_entry_becomes_a_storage_path() {
        let rest = artifact_rest("app://artifacts/exp/u1/a.png").expect("an artifact link");
        assert_eq!(rest, "exp/u1/a.png");
        let name = artifact_storage_name(rest, false);
        assert_eq!(artifact_storage_path("acct", &name), "acct/exp/u1/a.png");
    }

    // it: "turns app:// artifacts into storage paths" (non-artifacts pass through)
    #[test]
    fn other_entries_are_not_artifacts() {
        assert!(artifact_rest("keep").is_none());
        assert!(artifact_rest("acct/exp/u1/a.png").is_none());
        assert!(artifact_rest("app://artifacts/").is_none());
    }

    // it: "sends png/jpg up as webp and keeps svg as it is"
    #[test]
    fn png_and_jpg_names_become_webp_when_recompressed() {
        assert_eq!(artifact_storage_name("exp/u1/a.png", true), "exp/u1/a.webp");
        assert_eq!(artifact_storage_name("exp/u1/a.JPG", true), "exp/u1/a.webp");
        assert_eq!(
            artifact_storage_name("exp/u1/a.jpeg", true),
            "exp/u1/a.webp"
        );
    }

    // it: "sends png/jpg up as webp and keeps svg as it is" (svg stays)
    #[test]
    fn svg_keeps_its_name_and_type() {
        assert!(!should_recompress("image/svg+xml"));
        assert_eq!(artifact_storage_name("exp/u2/b.svg", false), "exp/u2/b.svg");
    }

    // it: "sends png/jpg up as webp and keeps svg as it is" (recompress only raster)
    #[test]
    fn only_png_and_jpeg_are_recompressed() {
        assert!(should_recompress("image/png"));
        assert!(should_recompress("image/jpeg"));
        assert!(!should_recompress("image/gif"));
    }

    #[test]
    fn webp_is_kept_only_when_smaller() {
        assert!(prefer_webp("image/webp", 10.0, 20.0));
        assert!(!prefer_webp("image/webp", 20.0, 20.0));
        assert!(!prefer_webp("image/png", 10.0, 20.0));
    }

    // it: "sends each metric point once, as the signed-in account" (cursor default)
    #[test]
    fn unpushed_series_reads_from_the_lowest_step() {
        assert_eq!(pushed_cursor(None), MIN_STEP);
        assert_eq!(pushed_cursor(Some(7.0)), 7.0);
    }

    #[test]
    fn push_sql_names_resolve() {
        assert!(push_sql("selectResets").is_some());
        assert!(
            push_sql("selectPointsAfter")
                .expect("known")
                .contains("limit 1000")
        );
        assert!(push_sql("nope").is_none());
    }

    // it: "sends each metric point once, as the signed-in account" (batch size and bucket)
    #[test]
    fn batch_and_bucket_are_the_pushed_constants() {
        assert_eq!(BATCH, 1000);
        assert_eq!(ARTIFACT_BUCKET, "experiment-artifacts");
    }

    #[test]
    fn account_pattern_matches_the_json_prefix_like_the_old_ts() {
        assert_eq!(account_artifacts_pattern("acct"), "%\"acct/%");
    }
}
