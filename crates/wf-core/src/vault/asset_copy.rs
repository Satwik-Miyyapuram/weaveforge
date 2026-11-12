//! Splits the outcome of copying a shared note's images into the paths that could not be
//! copied and the `vault:` rewrites for the ones that could (TS `DuplicateSharedVaultPageUseCase`).

use serde::{Deserialize, Serialize};

/// One image's copy attempt. `new_path` is `None` when the copy failed.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetCopy {
    pub old_path: String,
    pub new_path: Option<String>,
}

/// One `vault:` path rewrite, applied by `vault::page::replace_vault_asset_paths`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetRewrite {
    pub old_path: String,
    pub new_path: String,
}

/// The copy's outcome: images still borrowed from the owner, and the rewrites for the rest.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetCopyPlan {
    pub failed_assets: Vec<String>,
    pub rewrites: Vec<AssetRewrite>,
}

/// Failed copies keep the owner's path. Every copy that worked is rewritten, in the order given.
#[must_use]
pub fn plan_asset_copies(copies: &[AssetCopy]) -> AssetCopyPlan {
    let failed_assets = copies
        .iter()
        .filter(|copy| copy.new_path.is_none())
        .map(|copy| copy.old_path.clone())
        .collect();
    let rewrites = copies
        .iter()
        .filter_map(|copy| {
            copy.new_path.as_ref().map(|new_path| AssetRewrite {
                old_path: copy.old_path.clone(),
                new_path: new_path.clone(),
            })
        })
        .collect();
    AssetCopyPlan {
        failed_assets,
        rewrites,
    }
}

/// The text after the last `.` in `old_path`, as TS `old_path.split(".").pop()` returns it.
/// No lowercasing and no default: a path without a dot is returned whole, a trailing dot gives `""`.
#[must_use]
pub fn copy_extension(old_path: &str) -> &str {
    old_path.rsplit('.').next().unwrap_or("")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn copy(old: &str, new: Option<&str>) -> AssetCopy {
        AssetCopy {
            old_path: old.to_owned(),
            new_path: new.map(str::to_owned),
        }
    }

    // it: "an image that cannot be copied is reported, the others rewritten"
    #[test]
    fn an_image_that_cannot_be_copied_is_reported_and_the_others_rewritten() {
        let plan = plan_asset_copies(&[
            copy("owner/a.png", Some("mine/a.png")),
            copy("owner/b.png", None),
            copy("owner/c.png", Some("mine/c.png")),
        ]);
        assert_eq!(plan.failed_assets, vec!["owner/b.png"]);
        assert_eq!(
            plan.rewrites,
            vec![
                AssetRewrite {
                    old_path: "owner/a.png".to_owned(),
                    new_path: "mine/a.png".to_owned(),
                },
                AssetRewrite {
                    old_path: "owner/c.png".to_owned(),
                    new_path: "mine/c.png".to_owned(),
                },
            ]
        );
    }

    // it: "a clean copy reports nothing"
    #[test]
    fn a_clean_copy_reports_nothing() {
        let plan = plan_asset_copies(&[copy("owner/a.png", Some("mine/a.png"))]);
        assert!(plan.failed_assets.is_empty());
        assert_eq!(plan.rewrites.len(), 1);
    }

    // it: "the copy extension is the text after the last dot, as TS split('.').pop() gives it"
    #[test]
    fn the_copy_extension_matches_the_ts_split_pop() {
        assert_eq!(copy_extension("owner/a.png"), "png");
        assert_eq!(copy_extension("owner/a.tar.gz"), "gz");
        assert_eq!(copy_extension("owner/A.PNG"), "PNG");
        assert_eq!(copy_extension("owner/noext"), "owner/noext");
        assert_eq!(copy_extension("dir.x/file"), "x/file");
        assert_eq!(copy_extension("owner/trailing."), "");
    }
}
