//! Ported and property tests for `sync::blob_links`. Ports the blob-link cases of
//! `packages/core/test/workspace/workspace-roundtrip.test.ts` and the linear-time
//! loop in `packages/core/test/shared/markdown-image-refs.test.ts` (which also calls
//! `imagePathsInBody`; that helper is covered by the markdown-image lane).

use std::time::{Duration, Instant};

use proptest::prelude::*;
use wf_core::sync::blob_links::{
    BlobScheme, ImportedAssetResolver, RelativeAsset, from_relative_blob_links,
    relative_asset_paths, to_relative_blob_links,
};
use wf_core::sync::folder_layout::AssetScope;
use wf_core::sync::markdown_image::image_paths_in_body;

/// Resolves every path, as an archive that holds all of its files.
struct AllFiles;

impl ImportedAssetResolver for AllFiles {
    fn resolve(&self, _scope: AssetScope, relative_path: &str) -> Option<String> {
        Some(relative_path.to_owned())
    }
}

/// Resolves nothing: the archive held no assets.
struct NoFiles;

impl ImportedAssetResolver for NoFiles {
    fn resolve(&self, _scope: AssetScope, _relative_path: &str) -> Option<String> {
        None
    }
}

/// Resolves every path to one fixed storage path.
struct Fixed(&'static str);

impl ImportedAssetResolver for Fixed {
    fn resolve(&self, _scope: AssetScope, _relative_path: &str) -> Option<String> {
        Some(self.0.to_owned())
    }
}

// ---- workspace-roundtrip.test.ts ----

#[test]
fn blob_refs_become_folder_relative() {
    let out = to_relative_blob_links(
        "![](vault:user-1/n1/diagram.png)",
        "notes/method/baselines.note.md",
    );

    assert_eq!(out.body, "![](../../assets/notes/user-1/n1/diagram.png)");
    assert_eq!(out.assets.len(), 1);
    assert_eq!(out.assets[0].storage_path, "user-1/n1/diagram.png");
    assert_eq!(
        out.assets[0].folder_path,
        "assets/notes/user-1/n1/diagram.png"
    );
    assert_eq!(out.assets[0].scheme, BlobScheme::Vault);
}

#[test]
fn import_reanchors_assets_and_never_trusts_a_written_storage_path() {
    let body = "![](../assets/notes/other-user/n9/secret.png)";

    // An unknown asset must not become a storage ref.
    assert_eq!(from_relative_blob_links(body, &NoFiles), body);
    assert_eq!(
        from_relative_blob_links(body, &Fixed("me/n9/secret.png")),
        "![](vault:me/n9/secret.png)"
    );
}

// ---- markdown-image-refs.test.ts ----

#[test]
fn image_ref_scanning_stays_linear_on_unclosed_refs() {
    let inputs = [
        "![".repeat(50_000),
        "![](vault:!".repeat(50_000),
        format!("{})", "![](assets/notes/x".repeat(50_000)),
    ];
    for s in &inputs {
        let started = Instant::now();
        let _ = to_relative_blob_links(s, "a.md");
        let _ = from_relative_blob_links(s, &NoFiles);
        let _ = relative_asset_paths(s);
        let _ = image_paths_in_body(s, "vault:", ToOwned::to_owned);
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "slow on {}",
            &s[..20]
        );
    }
    assert_eq!(
        relative_asset_paths("![](assets/notes/x![a](../assets/report/r.png)"),
        vec![RelativeAsset {
            scope: "notes".to_owned(),
            path: "x![a](../assets/report/r.png".to_owned(),
        }]
    );
}

// ---- Rust-side cases for the rules the port enforces ----

#[test]
fn depth_is_the_number_of_slashes_in_the_file_path() {
    let shallow = to_relative_blob_links("![](vault:u/p.png)", "a.md");
    assert_eq!(shallow.body, "![](assets/notes/u/p.png)");

    let deep = to_relative_blob_links("![](vault:u/p.png)", "a/b/c.md");
    assert_eq!(deep.body, "![](../../assets/notes/u/p.png)");
}

#[test]
fn paper_and_report_schemes_map_to_their_asset_scopes() {
    let out = to_relative_blob_links(
        "![](paperimg:u/p1/a.png) ![](reportimg:u/r1/b.webp)",
        "a.md",
    );

    assert_eq!(
        out.body,
        "![](assets/papers/u/p1/a.png) ![](assets/report/u/r1/b.webp)"
    );
    assert_eq!(out.assets[0].scheme, BlobScheme::Paperimg);
    assert_eq!(out.assets[1].scheme, BlobScheme::Reportimg);
}

#[test]
fn alt_text_is_kept_as_written_not_escaped() {
    let out = to_relative_blob_links("![a (b)](vault:u/p.png)", "a.md");

    assert_eq!(out.body, "![a (b)](assets/notes/u/p.png)");
}

#[test]
fn to_relative_normalizes_wrapped_refs_first() {
    let out = to_relative_blob_links("![]( vault:u/p.png )", "a.md");

    assert_eq!(out.body, "![](assets/notes/u/p.png)");
}

#[test]
fn from_relative_does_not_normalize_wrapped_refs() {
    let body = "![]( ../assets/notes/x.png )";

    assert_eq!(from_relative_blob_links(body, &AllFiles), body);
}

#[test]
fn an_empty_resolution_keeps_the_ref() {
    let body = "![](../assets/notes/x.png)";

    assert_eq!(from_relative_blob_links(body, &Fixed("")), body);
}

#[test]
fn a_ref_with_no_path_after_its_scope_is_skipped() {
    let body = "![](../assets/notes/)";

    assert_eq!(from_relative_blob_links(body, &AllFiles), body);
    assert!(relative_asset_paths(body).is_empty());
}

#[test]
fn an_unknown_asset_scope_is_not_a_relative_ref() {
    let body = "![](../assets/other/x.png)";

    assert_eq!(from_relative_blob_links(body, &AllFiles), body);
    assert!(relative_asset_paths(body).is_empty());
}

#[test]
fn a_ref_nested_in_a_non_relative_target_is_still_found() {
    // The TS regex fails at the outer `![` (HEAD does not match "foo") and
    // retries at the inner one.
    let body = "![a](foo![b](assets/notes/x.png)";

    assert_eq!(
        from_relative_blob_links(body, &AllFiles),
        "![a](foo![b](vault:x.png)"
    );
    assert_eq!(
        relative_asset_paths(body),
        vec![RelativeAsset {
            scope: "notes".to_owned(),
            path: "x.png".to_owned(),
        }]
    );
}

#[test]
fn relative_asset_paths_reports_each_scope_and_path_in_order() {
    let found = relative_asset_paths(
        "![](../../assets/notes/u/a.png) ![x](assets/papers/u/b.pdf) ![](https://e.org/c.png)",
    );

    assert_eq!(
        found,
        vec![
            RelativeAsset {
                scope: "notes".to_owned(),
                path: "u/a.png".to_owned(),
            },
            RelativeAsset {
                scope: "papers".to_owned(),
                path: "u/b.pdf".to_owned(),
            },
        ]
    );
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    #[test]
    fn a_storage_path_survives_a_trip_through_the_folder(
        user in "[a-z0-9]{1,8}",
        page in "[a-z0-9]{1,8}",
        file in "[a-z0-9]{1,8}\\.png",
        depth in 0usize..4,
    ) {
        let storage = format!("{user}/{page}/{file}");
        let file_path = format!("{}n.md", "d/".repeat(depth));
        let body = format!("![x](vault:{storage})");

        let folder = to_relative_blob_links(&body, &file_path);

        prop_assert_eq!(folder.assets.len(), 1);
        prop_assert_eq!(from_relative_blob_links(&folder.body, &AllFiles), body);
    }
}
