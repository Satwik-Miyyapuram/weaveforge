//! Port of `packages/core/src/workspace/blob-links.ts`: rewrites blob refs
//! between the app's storage scheme (`vault:`, `paperimg:`, `reportimg:`) and
//! folder-relative `assets/<scope>/` paths, so an exported folder renders outside
//! the app. Import never trusts a stored path; it re-anchors through
//! [`ImportedAssetResolver`].

use crate::sync::folder_layout::{ASSET_DIR, AssetScope, asset_path};
use crate::sync::markdown_image::{
    normalize_markdown_image_syntax, replace_image_refs, replace_image_refs_by,
};

/// Storage scheme of an app blob ref.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BlobScheme {
    /// `vault:`, note images; scope `notes`.
    Vault,
    /// `paperimg:`, paper images; scope `papers`.
    Paperimg,
    /// `reportimg:`, report images; scope `report`.
    Reportimg,
}

/// Each scheme with its markdown head, in the order the TypeScript lists them.
const BLOB_HEADS: [(BlobScheme, &str); 3] = [
    (BlobScheme::Vault, "vault:"),
    (BlobScheme::Paperimg, "paperimg:"),
    (BlobScheme::Reportimg, "reportimg:"),
];

impl BlobScheme {
    /// The scheme's name as the TypeScript spells it.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Vault => "vault",
            Self::Paperimg => "paperimg",
            Self::Reportimg => "reportimg",
        }
    }

    /// The `assets/` tree this scheme's files live in.
    #[must_use]
    pub const fn scope(self) -> AssetScope {
        match self {
            Self::Vault => AssetScope::Notes,
            Self::Paperimg => AssetScope::Papers,
            Self::Reportimg => AssetScope::Report,
        }
    }
}

/// One blob ref, in both its storage and folder forms.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BlobAsset {
    /// The scheme the ref used.
    pub scheme: BlobScheme,
    /// The path after the scheme: `{userId}/{pageId}/{file}`.
    pub storage_path: String,
    /// The `assets/<scope>/...` path written into the folder.
    pub folder_path: String,
}

/// A body rewritten to folder-relative refs, with the assets it names.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RelativeLinks {
    /// The body with every blob ref folder-relative.
    pub body: String,
    /// Every rewritten blob ref, in body order.
    pub assets: Vec<BlobAsset>,
}

/// A folder-relative asset ref found in a body.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RelativeAsset {
    /// The asset tree: `notes`, `papers` or `report`.
    pub scope: String,
    /// The path after `assets/<scope>/`.
    pub path: String,
}

/// Maps a folder-relative asset path to a storage path under the importing user's
/// own namespace, or `None` when the archive did not hold that file.
pub trait ImportedAssetResolver {
    /// The storage path for `relative_path` under `scope`, if the archive has it.
    fn resolve(&self, scope: AssetScope, relative_path: &str) -> Option<String>;
}

/// App scheme → folder-relative. `file_path` is where the containing markdown file
/// sits, so the number of `../` hops is right for that file.
#[must_use]
pub fn to_relative_blob_links(body: &str, file_path: &str) -> RelativeLinks {
    let up = "../".repeat(file_path.matches('/').count());
    let mut assets = Vec::new();
    let rewritten = replace_image_refs(
        &normalize_markdown_image_syntax(body),
        &blob_heads(),
        |r| {
            let scheme = scheme_for_head(r.head)?;
            let folder_path = asset_path(scheme.scope(), r.rest);
            let link = format!("![{}]({up}{folder_path})", r.alt);
            assets.push(BlobAsset {
                scheme,
                storage_path: r.rest.to_owned(),
                folder_path,
            });
            Some(link)
        },
        false,
    );
    RelativeLinks {
        body: rewritten,
        assets,
    }
}

/// Folder-relative → app scheme, re-anchored through `resolver`. A ref the resolver
/// does not know (or resolves to an empty path) is kept as written: a broken image
/// is visible and harmless, a guessed storage path could name someone else's object.
#[must_use]
pub fn from_relative_blob_links(body: &str, resolver: &dyn ImportedAssetResolver) -> String {
    replace_image_refs_by(
        body,
        relative_head_only,
        |r| {
            let (scope, _) = relative_head_len(r.head)?;
            let storage_path = resolver.resolve(scope, r.rest).filter(|p| !p.is_empty())?;
            let scheme = scheme_for_scope(scope);
            Some(format!("![{}]({}:{storage_path})", r.alt, scheme.as_str()))
        },
        false,
    )
}

/// Every folder-relative asset path a body references, in body order.
#[must_use]
pub fn relative_asset_paths(body: &str) -> Vec<RelativeAsset> {
    let mut out = Vec::new();
    let _ = replace_image_refs_by(
        body,
        relative_head_only,
        |r| {
            if let Some((scope, _)) = relative_head_len(r.head) {
                out.push(RelativeAsset {
                    scope: scope.as_str().to_owned(),
                    path: r.rest.to_owned(),
                });
            }
            None
        },
        false,
    );
    out
}

fn blob_heads() -> Vec<&'static str> {
    BLOB_HEADS.iter().map(|(_, head)| *head).collect()
}

fn scheme_for_head(head: &str) -> Option<BlobScheme> {
    BLOB_HEADS
        .iter()
        .find(|(_, h)| *h == head)
        .map(|(scheme, _)| *scheme)
}

fn scheme_for_scope(scope: AssetScope) -> BlobScheme {
    match scope {
        AssetScope::Notes => BlobScheme::Vault,
        AssetScope::Papers => BlobScheme::Paperimg,
        AssetScope::Report => BlobScheme::Reportimg,
    }
}

/// `RELATIVE_HEAD` as a matcher for [`replace_image_refs_by`]. A target that does
/// not start with it is no match, so the scan retries at the next `![`, as the TS
/// regex does (a ref nested in a non-matching target is still found).
fn relative_head_only(target: &str) -> Option<usize> {
    relative_head_len(target).map(|(_, len)| len)
}

/// Length of `(?:\.\./)*assets/(notes|papers|report)/` at the start of `target`,
/// with its scope. Any number of `../` hops is accepted.
fn relative_head_len(target: &str) -> Option<(AssetScope, usize)> {
    let mut rest = target;
    while let Some(next) = rest.strip_prefix("../") {
        rest = next;
    }
    let after_assets = rest.strip_prefix(ASSET_DIR)?.strip_prefix('/')?;
    let (scope, tail) = [AssetScope::Notes, AssetScope::Papers, AssetScope::Report]
        .into_iter()
        .find_map(|scope| {
            after_assets
                .strip_prefix(scope.as_str())
                .and_then(|r| r.strip_prefix('/'))
                .map(|tail| (scope, tail))
        })?;
    Some((scope, target.len() - tail.len()))
}
