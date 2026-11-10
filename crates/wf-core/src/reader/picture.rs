//! Picture marks placed from the ink bar's Insert menu (`reader::picture`).
//! Port of `apps/web/src/features/reader/application/reader-picture.ts`.
//!
//! A picture is an ordinary `image` annotation whose comment names the stored file, so it
//! syncs, undoes and deletes like every other mark. The comment carries the crop (`c=`) and
//! the stacking order (`z=`) after the alt text.

use std::cmp::Ordering;

use serde::{Deserialize, Serialize};

use super::anchor::{AnchorCombinedPdf, AnchorZoteroPosition};
use super::annotation_draft::NewReaderAnnotation;
use super::annotation_helpers::ReaderAnnotation;
use super::text_units::is_js_space;
use super::viewport::build_annotation_sort_index;
use crate::ink::figure::parse_figure_crop;
use crate::ink::js_math;
use crate::papers::js_regex::{compile, space_class};
use crate::sync::frontmatter::js_number;
use crate::sync::ink_note::js_number_of;

/// `![picture((?:\s+[a-z]=[^\s\]]+)*)](path)` as one anchored pattern. `\s` outside a class is
/// rewritten by `js_regex::compile`; inside a class it is spelled out from `space_class()`.
fn picture_pattern() -> Option<regex_lite::Regex> {
    let sp = space_class();
    compile(&format!(
        r"^!\[picture((?:\s+[a-z]=[^{sp}\]]+)*)\]\(([^(){sp}]+)\)$"
    ))
    .ok()
}

/// One `c=` or `z=` token inside a picture comment, matched globally.
fn token_pattern() -> Option<regex_lite::Regex> {
    let sp = space_class();
    compile(&format!(r"\s([a-z])=([^{sp}\]]+)")).ok()
}

/// What a picture's comment says about it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PictureMeta {
    /// The stored file.
    pub path: String,
    /// Crop insets, `[left, top, right, bottom]` in percent; absent is the whole image.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crop: Option<[f64; 4]>,
    /// Paint order among the page's pictures: higher is on top.
    pub z: f64,
}

/// A placed picture as a figure: the PDF rectangle turned y-down from the page's head.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct FigureGeometry {
    /// Stored picture file.
    pub path: String,
    /// Left edge on the page.
    pub x: f64,
    /// Top edge on the page.
    pub y: f64,
    /// Width on the page.
    pub w: f64,
    /// Height on the page.
    pub h: f64,
    /// Visible part of the picture, when cropped.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub crop: Option<[f64; 4]>,
}

/// One page's picture in paint order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PagePicture {
    /// Stable picture id.
    pub id: String,
    /// Where and how large the picture is on the page.
    pub figure: FigureGeometry,
    /// Stacking order among the page's pictures.
    pub z: f64,
}

/// Input to [`draft_picture`] (TS `draftPicture` argument).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PictureDraftInput {
    /// Stored picture file to place.
    pub path: String,
    /// Page the picture goes on.
    pub page_index: f64,
    /// Unrotated page width in PDF user-space units.
    pub page_width: f64,
    /// Unrotated page height in PDF user-space units.
    pub page_height: f64,
    /// The picture's width over its height.
    pub aspect: f64,
}

/// A picture's meta read back from its comment; `None` for every other mark.
#[must_use]
pub fn picture_meta(kind: &str, comment: Option<&str>) -> Option<PictureMeta> {
    if kind != "image" {
        return None;
    }
    let trimmed = comment.unwrap_or("").trim_matches(is_js_space);
    let captures = picture_pattern()?.captures(trimmed)?;
    let mut meta = PictureMeta {
        path: captures.get(2)?.as_str().to_owned(),
        crop: None,
        z: 0.0,
    };
    if let (Some(tokens), Some(token_re)) = (captures.get(1), token_pattern()) {
        for token in token_re.captures_iter(tokens.as_str()) {
            let (Some(key), Some(value)) = (token.get(1), token.get(2)) else {
                continue;
            };
            match key.as_str() {
                "z" => {
                    let z = js_number_of(value.as_str());
                    if z.is_finite() {
                        meta.z = z;
                    }
                }
                "c" => {
                    if let Some(crop) = parse_figure_crop(value.as_str()) {
                        meta.crop = Some(crop);
                    }
                }
                _ => {}
            }
        }
    }
    Some(meta)
}

/// The comment that says `meta`: the inverse of [`picture_meta`].
#[must_use]
pub fn picture_comment(meta: &PictureMeta) -> String {
    let mut tokens: Vec<String> = Vec::new();
    if let Some(crop) = meta.crop {
        if crop.iter().any(|n| *n > 0.0) {
            let joined = crop
                .iter()
                .map(|n| js_number(*n))
                .collect::<Vec<_>>()
                .join(",");
            tokens.push(format!("c={joined}"));
        }
    }
    if meta.z != 0.0 {
        tokens.push(format!("z={}", js_number(meta.z)));
    }
    let suffix: String = tokens.iter().map(|t| format!(" {t}")).collect();
    format!("![picture{suffix}]({})", meta.path)
}

/// The stored file behind a placed picture; `None` for every other mark.
#[must_use]
pub fn picture_path(kind: &str, comment: Option<&str>) -> Option<String> {
    picture_meta(kind, comment).map(|meta| meta.path)
}

/// A page's pictures in paint order, as figures. PDF rectangles are y-up from the page's foot,
/// figures are y-down from its head, so `y` is the page height less the rectangle's top.
#[must_use]
pub fn page_pictures(annotations: &[ReaderAnnotation], page_height: f64) -> Vec<PagePicture> {
    let mut out = Vec::new();
    for annotation in annotations {
        let Some(meta) = picture_meta(&annotation.kind, annotation.comment.as_deref()) else {
            continue;
        };
        let Some(rect) = annotation
            .anchor
            .zotero_position
            .as_ref()
            .and_then(|position| position.rects.as_ref())
            .and_then(|rects| rects.first())
        else {
            continue;
        };
        if rect.len() < 4 {
            continue;
        }
        let (x1, y1, x2, y2) = (rect[0], rect[1], rect[2], rect[3]);
        out.push(PagePicture {
            id: annotation.id.clone(),
            figure: FigureGeometry {
                path: meta.path,
                x: js_math::min(x1, x2),
                y: page_height - js_math::max(y1, y2),
                w: (x2 - x1).abs(),
                h: (y2 - y1).abs(),
                crop: meta.crop,
            },
            z: meta.z,
        });
    }
    // Stable sort: pictures with one z keep the order they were placed in.
    out.sort_by(|a, b| a.z.partial_cmp(&b.z).unwrap_or(Ordering::Equal));
    out
}

/// A figure's box back as the PDF rectangle it came from: `[x1, y1, x2, y2]`.
#[must_use]
pub fn picture_rect(figure: &FigureGeometry, page_height: f64) -> [f64; 4] {
    [
        figure.x,
        page_height - figure.y - figure.h,
        figure.x + figure.w,
        page_height - figure.y,
    ]
}

/// A picture laid in the middle of a page, half the page wide, at its own aspect ratio (capped
/// so a tall one still fits the page).
#[must_use]
pub fn draft_picture(input: &PictureDraftInput) -> NewReaderAnnotation {
    let aspect = if input.aspect > 0.0 && input.aspect.is_finite() {
        input.aspect
    } else {
        4.0 / 3.0
    };
    let mut width = input.page_width * 0.5;
    let mut height = width / aspect;
    if height > input.page_height * 0.8 {
        height = input.page_height * 0.8;
        width = height * aspect;
    }
    let x1 = (input.page_width - width) / 2.0;
    let y1 = (input.page_height - height) / 2.0;
    NewReaderAnnotation {
        kind: "image".to_owned(),
        color: "transparent".to_owned(),
        text: String::new(),
        comment: Some(format!("![picture]({})", input.path)),
        tags: Vec::new(),
        page_index: input.page_index,
        anchor: AnchorCombinedPdf {
            content_hash: None,
            zotero_position: Some(AnchorZoteroPosition {
                page_index: Some(input.page_index),
                rects: Some(vec![vec![x1, y1, x1 + width, y1 + height]]),
                ..Default::default()
            }),
            locus: None,
        },
        sort_index: build_annotation_sort_index(
            input.page_index,
            0.0,
            input.page_height - (y1 + height),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn image_annotation(id: &str, comment: &str, rect: Vec<f64>) -> ReaderAnnotation {
        ReaderAnnotation {
            id: id.to_owned(),
            kind: "image".to_owned(),
            comment: Some(comment.to_owned()),
            anchor: AnchorCombinedPdf {
                zotero_position: Some(AnchorZoteroPosition {
                    page_index: Some(0.0),
                    rects: Some(vec![rect]),
                    ..Default::default()
                }),
                ..Default::default()
            },
            ..Default::default()
        }
    }

    fn fixture_input(aspect: f64) -> PictureDraftInput {
        PictureDraftInput {
            path: "p/1.png".to_owned(),
            page_index: 2.0,
            page_width: 600.0,
            page_height: 800.0,
            aspect,
        }
    }

    #[test]
    fn lays_a_picture_half_the_page_wide_centred_at_its_own_shape() {
        let draft = draft_picture(&fixture_input(2.0));
        assert_eq!(draft.kind, "image");
        assert_eq!(draft.page_index, 2.0);
        assert_eq!(
            draft.anchor.zotero_position.and_then(|p| p.rects),
            Some(vec![vec![150.0, 325.0, 450.0, 475.0]])
        );
        assert_eq!(
            picture_path(&draft.kind, draft.comment.as_deref()).as_deref(),
            Some("p/1.png")
        );
    }

    #[test]
    fn keeps_a_tall_picture_on_the_page() {
        let draft = draft_picture(&PictureDraftInput {
            path: "t.png".to_owned(),
            ..fixture_input(0.1)
        });
        let rect = draft
            .anchor
            .zotero_position
            .and_then(|p| p.rects)
            .and_then(|rects| rects.into_iter().next())
            .expect("one rect");
        let (x1, y1, x2, y2) = (rect[0], rect[1], rect[2], rect[3]);
        assert!(y2 - y1 <= 640.0 + 1e-9);
        assert!(x1 >= 0.0 && x2 <= 600.0);
    }

    #[test]
    fn never_reads_a_clips_own_words_as_a_picture() {
        assert_eq!(picture_path("image", Some("a figure worth keeping")), None);
        assert_eq!(picture_path("note", Some("![picture](p/1.png)")), None);
    }

    #[test]
    fn reads_and_writes_a_pictures_crop_and_stacking_order() {
        let meta = PictureMeta {
            path: "p/1.png".to_owned(),
            crop: Some([10.0, 0.0, 5.0, 20.0]),
            z: 2.0,
        };
        let comment = picture_comment(&meta);
        assert_eq!(comment, "![picture c=10,0,5,20 z=2](p/1.png)");
        assert_eq!(
            picture_meta("image", Some(comment.as_str())),
            Some(PictureMeta {
                path: "p/1.png".to_owned(),
                crop: Some([10.0, 0.0, 5.0, 20.0]),
                z: 2.0,
            })
        );
        assert_eq!(
            picture_path("image", Some(comment.as_str())).as_deref(),
            Some("p/1.png")
        );
        // The plain form, and a crop cleared back to nothing, stay the plain form.
        let plain = PictureMeta {
            path: "p/1.png".to_owned(),
            crop: Some([0.0, 0.0, 0.0, 0.0]),
            z: 0.0,
        };
        assert_eq!(picture_comment(&plain), "![picture](p/1.png)");
    }

    #[test]
    fn turns_a_pages_pictures_into_figures_y_down_in_paint_order() {
        let list = page_pictures(
            &[
                image_annotation(
                    "a",
                    "![picture z=1](a.png)",
                    vec![100.0, 500.0, 300.0, 700.0],
                ),
                image_annotation("b", "![picture](b.png)", vec![0.0, 0.0, 50.0, 50.0]),
                image_annotation("c", "a clip", vec![0.0, 0.0, 10.0, 10.0]),
            ],
            800.0,
        );
        let ids: Vec<&str> = list.iter().map(|one| one.id.as_str()).collect();
        assert_eq!(ids, vec!["b", "a"]);
        assert_eq!(
            list[1].figure,
            FigureGeometry {
                path: "a.png".to_owned(),
                x: 100.0,
                y: 100.0,
                w: 200.0,
                h: 200.0,
                crop: None,
            }
        );
        assert_eq!(
            picture_rect(&list[1].figure, 800.0),
            [100.0, 500.0, 300.0, 700.0]
        );
    }
}
