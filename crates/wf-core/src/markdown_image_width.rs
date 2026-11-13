//! An image's display width and placement, written into its markdown alt (wf-core
//! `markdown_image_width`). Ported from `apps/web/src/lib/markdown-image-width.ts`.
//!
//! `![diagram|50%](vault:…)` and `![diagram|400](vault:…)` are the Obsidian suffix. Every function
//! here reads and writes through [`crate::markdown_figure_alt`], so changing a width cannot drop a
//! crop or an alignment.

use regex_lite::Regex;
use serde::{Deserialize, Deserializer};

use crate::markdown_figure_alt::{MdAlign, MdPlacement, parse_md_image_alt, with_md_image_alt};

/// Every image reference: alt captured in group 1, target in group 2. The target class is JS `\s`
/// spelled out, because regex-lite's `\s` is ASCII only.
const IMAGE_REF: &str = r"!\[([^\]]*)\]\(([^\t\n\x0B\x0C\r \x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff})]+)\)";

/// A placement change: an absent field keeps what the alt already has, `null` clears it, and a
/// value sets it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ImagePlacementPatch {
    /// Crop insets: absent keeps, `null` clears, a value sets.
    #[serde(default, deserialize_with = "double_option")]
    #[cfg_attr(feature = "specta", specta(optional, type = Option<[u8; 4]>))]
    pub crop: Option<Option<[u8; 4]>>,
    /// Alignment: absent keeps, `null` clears, a value sets.
    #[serde(default, deserialize_with = "double_option")]
    #[cfg_attr(feature = "specta", specta(optional, type = Option<MdAlign>))]
    pub align: Option<Option<MdAlign>>,
    /// Width: absent keeps, `null` clears, a value sets.
    #[serde(default, deserialize_with = "double_option")]
    #[cfg_attr(feature = "specta", specta(optional, type = Option<String>))]
    pub width: Option<Option<String>>,
}

/// Read an explicit `null` as `Some(None)`; serde would fold it into the outer `None`.
fn double_option<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

/// The alt text for a width, keeping any crop or alignment. `None` clears the width.
#[must_use]
pub fn with_image_width(alt: &str, width: Option<&str>) -> String {
    let parts = parse_md_image_alt(alt);
    with_md_image_alt(
        &parts.alt,
        &MdPlacement {
            crop: parts.crop,
            align: parts.align,
            width: width.map(str::to_owned),
        },
    )
}

/// The alt text for a figure's own text plus its placement, with the patch applied field by field.
#[must_use]
pub fn with_image_placement(raw: &str, patch: &ImagePlacementPatch) -> String {
    let current = parse_md_image_alt(raw);
    let placement = MdPlacement {
        crop: patch.crop.unwrap_or(current.crop),
        align: patch.align.unwrap_or(current.align),
        width: match &patch.width {
            Some(width) => width.clone(),
            None => current.width,
        },
    };
    with_md_image_alt(&current.alt, &placement)
}

/// Rewrite the `ordinal`-th image whose own alt text is `alt` to the patched placement.
///
/// One click can change width, crop and side in one write, because three separate writes could
/// land on an alt that moved between them.
#[must_use]
pub fn set_image_placement(
    body: &str,
    alt: &str,
    ordinal: usize,
    patch: &ImagePlacementPatch,
) -> String {
    let Ok(re) = Regex::new(IMAGE_REF) else {
        return body.to_owned();
    };
    let mut out = String::with_capacity(body.len());
    let mut last = 0;
    let mut seen = 0_usize;
    for caps in re.captures_iter(body) {
        let (Some(whole), Some(raw_alt), Some(target)) = (caps.get(0), caps.get(1), caps.get(2))
        else {
            continue;
        };
        if parse_md_image_alt(raw_alt.as_str()).alt != alt {
            continue;
        }
        let index = seen;
        seen += 1;
        if index != ordinal {
            continue;
        }
        out.push_str(&body[last..whole.start()]);
        out.push_str(&format!(
            "![{}]({})",
            with_image_placement(raw_alt.as_str(), patch),
            target.as_str()
        ));
        last = whole.end();
    }
    out.push_str(&body[last..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn patch(
        crop: Option<Option<[u8; 4]>>,
        align: Option<Option<MdAlign>>,
        width: Option<Option<&str>>,
    ) -> ImagePlacementPatch {
        ImagePlacementPatch {
            crop,
            align,
            width: width.map(|inner| inner.map(str::to_owned)),
        }
    }

    #[test]
    fn with_image_width_writes_and_clears_the_suffix() {
        assert_eq!(with_image_width("Figure 1", Some("40%")), "Figure 1|40%");
        assert_eq!(
            with_image_width("Figure 1|40%", Some("60%")),
            "Figure 1|60%"
        );
        assert_eq!(with_image_width("Figure 1|40%", None), "Figure 1");
    }

    #[test]
    fn with_image_width_keeps_crop_and_side() {
        assert_eq!(
            with_image_width("photo right c=0,0,10,10", Some("40%")),
            "photo right c=0,0,10,10|40%"
        );
    }

    #[test]
    fn a_new_side_replaces_the_old_one_and_keeps_the_rest() {
        let body = "![photo right c=0,0,10,10|40%](x.png)";
        let left = patch(None, Some(Some(MdAlign::Left)), None);
        assert_eq!(
            set_image_placement(body, "photo", 0, &left),
            "![photo left c=0,0,10,10|40%](x.png)"
        );
    }

    #[test]
    fn a_new_crop_replaces_the_insets_and_keeps_the_rest() {
        let body = "![photo right c=0,0,10,10|40%](x.png)";
        let crop = patch(Some(Some([5, 5, 5, 5])), None, None);
        assert_eq!(
            set_image_placement(body, "photo", 0, &crop),
            "![photo right c=5,5,5,5|40%](x.png)"
        );
    }

    #[test]
    fn explicit_nulls_reset_all_three() {
        let body = "![photo right c=0,0,10,10|40%](x.png)";
        let reset = patch(Some(None), Some(None), Some(None));
        assert_eq!(
            set_image_placement(body, "photo", 0, &reset),
            "![photo](x.png)"
        );
    }

    #[test]
    fn an_absent_field_keeps_what_the_alt_has() {
        let body = "![photo c=1,2,3,4|60%](x.png)";
        let none = patch(None, None, None);
        assert_eq!(set_image_placement(body, "photo", 0, &none), body);
    }

    #[test]
    fn ordinal_picks_the_matching_image_only() {
        let body = "![a](1.png) ![photo](2.png) ![photo](3.png)";
        let second = patch(None, None, Some(Some("50%")));
        assert_eq!(
            set_image_placement(body, "photo", 1, &second),
            "![a](1.png) ![photo](2.png) ![photo|50%](3.png)"
        );
    }

    #[test]
    fn a_target_with_whitespace_is_not_an_image_ref() {
        let body = "![photo](a b.png)";
        let width = patch(None, None, Some(Some("50%")));
        assert_eq!(set_image_placement(body, "photo", 0, &width), body);
    }
}
