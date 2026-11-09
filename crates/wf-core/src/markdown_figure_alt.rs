//! Figure crop, alignment and width written into a markdown image's alt text (wf-core
//! `markdown_figure_alt`). Ported from `apps/web/src/lib/markdown-figure-alt.ts`.
//!
//! `![photo right c=0,0,10,10|60%](x.png)` keeps all three placement ideas in the alt. Saved notes
//! carry this spelling, so the parse and the write must stay exactly the same as the TypeScript.

use serde::{Deserialize, Serialize};

use crate::search::js_text::is_js_whitespace;

/// The crop token key, `c=`, followed by four comma-separated insets.
const CROP_KEY: &str = "c=";

/// Where a figure sits in the column.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum MdAlign {
    /// Against the left margin.
    Left,
    /// Against the right margin.
    Right,
    /// Centred in the column.
    Center,
}

impl MdAlign {
    /// The word written into the alt.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Left => "left",
            Self::Right => "right",
            Self::Center => "center",
        }
    }

    fn from_word(word: &str) -> Option<Self> {
        match word {
            "left" => Some(Self::Left),
            "right" => Some(Self::Right),
            "center" => Some(Self::Center),
            _ => None,
        }
    }
}

/// An image alt split into its own text and its placement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct MdImageAlt {
    /// The alt's own text, everything that is neither a token nor a width.
    pub alt: String,
    /// Crop insets `[left, top, right, bottom]`, each 0..=99; absent for none.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub crop: Option<[u8; 4]>,
    /// Column placement; absent for the document's own default.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub align: Option<MdAlign>,
    /// `"50%"` or `"400px"`; absent when the alt carries no width.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub width: Option<String>,
}

/// The placement to write into an alt. An absent or `null` field means none.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct MdPlacement {
    /// Crop insets to write.
    #[cfg_attr(feature = "specta", specta(optional))]
    pub crop: Option<[u8; 4]>,
    /// Alignment word to write.
    #[cfg_attr(feature = "specta", specta(optional))]
    pub align: Option<MdAlign>,
    /// Width to write, `"40%"` or a pixel count.
    #[cfg_attr(feature = "specta", specta(optional))]
    pub width: Option<String>,
}

/// Split an image alt into its own text, its crop, its alignment and its width suffix.
///
/// The crop and the alignment are stripped from the text, because they are placement and not
/// description. A word that is not the alt's last word stays text: `a right answer` keeps its
/// `right`.
#[must_use]
pub fn parse_md_image_alt(raw: &str) -> MdImageAlt {
    // The width first: its digits would otherwise read as a crop's.
    let (without_width, width) = split_width(raw);
    let (rest, crop) = take_crop(without_width);
    let mut words: Vec<&str> = rest
        .split(is_js_whitespace)
        .filter(|word| !word.is_empty())
        .collect();
    let align = words.last().and_then(|word| MdAlign::from_word(word));
    if align.is_some() {
        words.pop();
    }
    MdImageAlt {
        alt: words.join(" "),
        crop,
        align,
        width,
    }
}

/// The alt text for a figure's own text and its placement, in the spelling
/// [`parse_md_image_alt`] reads back.
#[must_use]
pub fn with_md_image_alt(alt: &str, placement: &MdPlacement) -> String {
    let own = alt.trim_matches(is_js_whitespace);
    let mut words: Vec<&str> = Vec::new();
    if !own.is_empty() {
        words.push(own);
    }
    if let Some(align) = placement.align {
        words.push(align.as_str());
    }
    let mut out = words.join(" ");
    if let Some([left, top, right, bottom]) = placement.crop {
        out.push_str(&format!(" {CROP_KEY}{left},{top},{right},{bottom}"));
    }
    let width = placement.width.as_deref().unwrap_or("");
    if let Some(n) = parse_js_int(width).filter(|n| *n > 0) {
        let value = if width.ends_with('%') {
            format!("{}%", n.min(100))
        } else {
            n.to_string()
        };
        out.push('|');
        out.push_str(&value);
    }
    out
}

/// The width suffix `|40%` or `|300`, and the text before it. Matches
/// `\|\s*(\d{1,4})(%?)\s*$` in the TypeScript.
fn split_width(raw: &str) -> (&str, Option<String>) {
    let trimmed = raw.trim_end_matches(is_js_whitespace);
    let (body, percent) = match trimmed.strip_suffix('%') {
        Some(body) => (body, true),
        None => (trimmed, false),
    };
    let head = body.trim_end_matches(|ch: char| ch.is_ascii_digit());
    let digit_count = body.len() - head.len();
    if !(1..=4).contains(&digit_count) {
        return (raw, None);
    }
    let Some(before_pipe) = head
        .trim_end_matches(is_js_whitespace)
        .strip_suffix('|')
    else {
        return (raw, None);
    };
    let width = body[head.len()..]
        .parse::<u32>()
        .ok()
        .filter(|n| *n > 0)
        .map(|n| {
            if percent {
                format!("{}%", n.min(100))
            } else {
                format!("{n}px")
            }
        });
    (before_pipe.trim_end_matches(is_js_whitespace), width)
}

/// Remove the first well-formed crop token. Returns the rest of the text and the insets.
fn take_crop(text: &str) -> (String, Option<[u8; 4]>) {
    for (start, _) in text.match_indices(CROP_KEY) {
        // `\b` before the `c`: the character before must not be a word character.
        if text[..start].chars().next_back().is_some_and(is_word_char) {
            continue;
        }
        let value_start = start + CROP_KEY.len();
        if let Some((len, insets)) = parse_insets(&text[value_start..]) {
            let rest = format!("{}{}", &text[..start], &text[value_start + len..]);
            return (rest.trim_end_matches(is_js_whitespace).to_owned(), Some(insets));
        }
    }
    (text.to_owned(), None)
}

/// Four `1..=3` digit insets separated by commas, not followed by another digit. Returns the
/// bytes consumed and the insets clamped to 0..=99.
fn parse_insets(text: &str) -> Option<(usize, [u8; 4])> {
    let bytes = text.as_bytes();
    let mut pos = 0;
    let mut insets = [0_u8; 4];
    for (index, inset) in insets.iter_mut().enumerate() {
        if index > 0 {
            if bytes.get(pos) != Some(&b',') {
                return None;
            }
            pos += 1;
        }
        let start = pos;
        let mut value: u32 = 0;
        while pos - start < 3 {
            let Some(&digit) = bytes.get(pos).filter(|byte| byte.is_ascii_digit()) else {
                break;
            };
            value = value * 10 + u32::from(digit - b'0');
            pos += 1;
        }
        if pos == start {
            return None;
        }
        *inset = u8::try_from(value.min(99)).unwrap_or(99);
    }
    if bytes.get(pos).is_some_and(u8::is_ascii_digit) {
        return None;
    }
    Some((pos, insets))
}

/// JavaScript `parseInt(text, 10)`: leading whitespace, optional sign, then digits. `None` when
/// there are no digits.
fn parse_js_int(text: &str) -> Option<i64> {
    let trimmed = text.trim_start_matches(is_js_whitespace);
    let (negative, digits) = match trimmed.as_bytes().first() {
        Some(b'-') => (true, &trimmed[1..]),
        Some(b'+') => (false, &trimmed[1..]),
        _ => (false, trimmed),
    };
    let run = digits.bytes().take_while(u8::is_ascii_digit).count();
    if run == 0 {
        return None;
    }
    let value = digits.as_bytes()[..run]
        .iter()
        .fold(0_i64, |acc, byte| {
            acc.saturating_mul(10)
                .saturating_add(i64::from(byte - b'0'))
        });
    Some(if negative { -value } else { value })
}

fn is_word_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_'
}

#[cfg(test)]
mod tests {
    use super::*;

    fn placement(
        crop: Option<[u8; 4]>,
        align: Option<MdAlign>,
        width: Option<&str>,
    ) -> MdPlacement {
        MdPlacement {
            crop,
            align,
            width: width.map(str::to_owned),
        }
    }

    fn own(alt: &str) -> MdImageAlt {
        MdImageAlt {
            alt: alt.to_owned(),
            crop: None,
            align: None,
            width: None,
        }
    }

    #[test]
    fn plain_alt_is_all_description() {
        assert_eq!(parse_md_image_alt("Figure 1"), own("Figure 1"));
    }

    #[test]
    fn width_suffix_is_a_width() {
        let percent = parse_md_image_alt("Figure 1|40%");
        assert_eq!(percent.alt, "Figure 1");
        assert_eq!(percent.width.as_deref(), Some("40%"));
        assert_eq!(parse_md_image_alt("Figure 1|300").width.as_deref(), Some("300px"));
        assert_eq!(parse_md_image_alt("x|140%").width.as_deref(), Some("100%"));
        // Zero is no width, but the suffix still comes off the alt.
        let zero = parse_md_image_alt("x|0%");
        assert_eq!((zero.alt.as_str(), zero.width), ("x", None));
    }

    #[test]
    fn crop_is_four_clamped_insets() {
        let parsed = parse_md_image_alt("photo c=0,0,10,10");
        assert_eq!(parsed.alt, "photo");
        assert_eq!(parsed.crop, Some([0, 0, 10, 10]));
        let with_width = parse_md_image_alt("photo c=1,2,3,4|60%");
        assert_eq!(with_width.crop, Some([1, 2, 3, 4]));
        assert_eq!(with_width.width.as_deref(), Some("60%"));
        assert_eq!(parse_md_image_alt("photo c=150,0,0,0").crop, Some([99, 0, 0, 0]));
    }

    #[test]
    fn three_insets_are_text_not_a_crop() {
        assert_eq!(parse_md_image_alt("photo c=1,2,3"), own("photo c=1,2,3"));
    }

    #[test]
    fn crop_needs_a_word_boundary_before_the_c() {
        assert_eq!(parse_md_image_alt("photo xc=0,0,0,0"), own("photo xc=0,0,0,0"));
    }

    #[test]
    fn alignment_word_at_the_end_is_placement() {
        let right = parse_md_image_alt("photo right");
        assert_eq!(right.alt, "photo");
        assert_eq!(right.align, Some(MdAlign::Right));
        let left = parse_md_image_alt("photo left|50%");
        assert_eq!(left.align, Some(MdAlign::Left));
        assert_eq!(left.width.as_deref(), Some("50%"));
    }

    #[test]
    fn alignment_word_inside_text_is_description() {
        assert_eq!(parse_md_image_alt("the right answer"), own("the right answer"));
    }

    #[test]
    fn all_three_together() {
        let parsed = parse_md_image_alt("photo right c=0,0,10,10|60%");
        assert_eq!(
            parsed,
            MdImageAlt {
                alt: "photo".to_owned(),
                crop: Some([0, 0, 10, 10]),
                align: Some(MdAlign::Right),
                width: Some("60%".to_owned()),
            }
        );
    }

    #[test]
    fn writes_what_it_reads() {
        assert_eq!(
            with_md_image_alt(
                "photo",
                &placement(Some([0, 0, 10, 10]), Some(MdAlign::Right), Some("60%")),
            ),
            "photo right c=0,0,10,10|60%"
        );
        assert_eq!(with_md_image_alt("photo", &placement(None, None, None)), "photo");
        assert_eq!(
            with_md_image_alt("photo", &placement(None, None, Some("140%"))),
            "photo|100%"
        );
        let written = with_md_image_alt(
            "photo",
            &placement(Some([1, 2, 3, 4]), Some(MdAlign::Center), None),
        );
        assert_eq!(
            parse_md_image_alt(&written),
            MdImageAlt {
                alt: "photo".to_owned(),
                crop: Some([1, 2, 3, 4]),
                align: Some(MdAlign::Center),
                width: None,
            }
        );
    }

    #[test]
    fn width_in_pixels_is_written_bare() {
        assert_eq!(
            with_md_image_alt("photo", &placement(None, None, Some("400px"))),
            "photo|400"
        );
    }
}
