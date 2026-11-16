//! OneNote `.one` section import: pages become Markdown, images and ink pages.

use std::collections::HashMap;
use std::io::{Error, Read};

use onenote_parser::contents::{
    Content, EmbeddedFile, Image, Outline, OutlineElement, OutlineItem, RichText, Table,
};
use onenote_parser::page::{Page, PageContent};
use onenote_parser::FileSystem;
use onenote_parser::Parser;
use serde::{Deserialize, Serialize};
use typed_path::{TypedPath, TypedPathBuf};

use crate::bytea::encode_base64;
use crate::ink::ink_page::{InkPage, INK_A4_HEIGHT, INK_A4_WIDTH};

mod freeform;
mod ink;

pub use freeform::{freeform_canvas, ink_strokes, LayoutKind, OneNoteLayoutItem};

/// Canvas text for a freeform page: `layout` pieces, each image's vault path in
/// `files`, and every ink page's strokes placed at its origin on the page.
pub fn freeform_page_text(
    layout: &[OneNoteLayoutItem],
    files: &std::collections::BTreeMap<String, String>,
    ink: &[OneNoteInkPage],
) -> String {
    let strokes: Vec<crate::canvas::FreeStroke> = ink
        .iter()
        .enumerate()
        .flat_map(|(part, sheet)| {
            ink_strokes(
                (sheet.origin_x, sheet.origin_y),
                &sheet.page,
                &format!("ink-{part}-"),
            )
        })
        .collect();
    freeform_canvas(layout, files, &strokes)
}

/// Largest `.one` input accepted, in bytes.
pub const ONENOTE_MAX_BYTES: usize = 64 * 1024 * 1024;
/// Largest embedded image copied into the import, in bytes.
const IMAGE_MAX_BYTES: u64 = 20 * 1024 * 1024;

/// An imported OneNote section.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct OneNoteSection {
    /// Section display name.
    pub name: String,
    /// Pages in notebook order.
    pub pages: Vec<OneNotePage>,
    /// Non-fatal problems met during import.
    pub warnings: Vec<String>,
}

/// One imported OneNote page.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct OneNotePage {
    /// Trimmed page title, or `Untitled page`.
    pub title: String,
    /// Page indent level, `0` for top level.
    pub level: u32,
    /// Page text as Markdown; empty when the page has ink, whose pages carry the text.
    pub markdown: String,
    /// Images referenced from `markdown`, the ink pages' text and their backgrounds.
    pub images: Vec<OneNoteImage>,
    /// Ink pages, empty when the page has no ink.
    pub ink: Vec<OneNoteInkPage>,
    /// Positioned pieces for the freeform view, in page order.
    pub layout: Vec<OneNoteLayoutItem>,
}

/// One ink page of an imported OneNote page.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct OneNoteInkPage {
    /// Strokes and page size.
    pub page: InkPage,
    /// Printout page drawn under the strokes, if any.
    pub background: Option<OneNoteBackground>,
    /// Where this page's top-left corner sits on the OneNote page, in 0.1 mm.
    pub origin_x: f64,
    /// See `origin_x`.
    pub origin_y: f64,
    /// Typed text that sat on this part of the OneNote page, as Markdown.
    pub text: String,
}

/// Where a background image sits on an ink page, in 0.1 mm.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct OneNoteBackground {
    /// Name of the image in the page's `images`.
    pub name: String,
    /// Left edge.
    pub x: f64,
    /// Top edge.
    pub y: f64,
    /// Width.
    pub width: f64,
    /// Height.
    pub height: f64,
}

/// An image referenced from a page's Markdown.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct OneNoteImage {
    /// File name the Markdown refers to, such as `image-1.png`.
    pub name: String,
    /// Alt text with brackets removed.
    pub alt: String,
    /// Image bytes, base64 encoded.
    pub base64: String,
}

/// Parses a `.one` section into pages; `file_name` is only used in messages.
pub fn import_section(bytes: &[u8], file_name: &str) -> Result<OneNoteSection, String> {
    if bytes.len() > ONENOTE_MAX_BYTES {
        return Err(format!(
            "OneNote section is larger than {} MiB",
            ONENOTE_MAX_BYTES / (1024 * 1024)
        ));
    }
    let section = Parser::new_with_fs(NoFs)
        .parse_section_buffer(bytes, TypedPath::derive(file_name))
        .map_err(|e| format!("not a OneNote section: {e}"))?;

    let mut pages = Vec::new();
    let mut warnings = Vec::new();
    for series in section.page_series() {
        for page in series.pages() {
            let (converted, page_warnings) = convert_page(page);
            let number = pages.len() + 1;
            warnings.extend(
                page_warnings
                    .into_iter()
                    .map(|warning| format!("page {number}: {warning}")),
            );
            pages.push(converted);
        }
    }
    // OneNote numbers top-level pages 1; make the shallowest page level 0.
    let top = pages.iter().map(|page| page.level).min().unwrap_or(0);
    for page in &mut pages {
        page.level -= top;
    }
    Ok(OneNoteSection {
        name: section.display_name().to_string(),
        pages,
        warnings,
    })
}

/// Filesystem stub; section buffers are parsed from memory and never touch disk.
#[derive(Clone, Copy)]
struct NoFs;

fn no_fs() -> Error {
    Error::other("filesystem access is not supported for section buffers")
}

impl FileSystem for NoFs {
    fn is_directory(&self, _path: TypedPath) -> Result<bool, Error> {
        Err(no_fs())
    }

    fn read_dir(&self, _path: TypedPath) -> Result<Vec<TypedPathBuf>, Error> {
        Err(no_fs())
    }

    fn read_file(&self, _path: TypedPath) -> Result<Vec<u8>, Error> {
        Err(no_fs())
    }

    fn write_file(&self, _path: TypedPath, _data: &[u8]) -> Result<(), Error> {
        Err(no_fs())
    }

    fn stream_to_file(&self, _path: TypedPath, _reader: &mut dyn Read) -> Result<(), Error> {
        Err(no_fs())
    }

    fn make_dir(&self, _path: TypedPath) -> Result<(), Error> {
        Err(no_fs())
    }

    fn canonicalize(&self, _path: TypedPath) -> Result<TypedPathBuf, Error> {
        Err(no_fs())
    }

    fn exists(&self, _path: TypedPath) -> Result<bool, Error> {
        Err(no_fs())
    }
}

/// Markdown blocks for one page, plus its images and warnings.
#[derive(Default)]
struct Body {
    blocks: Vec<Block>,
    images: Vec<OneNoteImage>,
    warnings: Vec<String>,
    /// Set for outline text alone: images are left to the page's layout.
    text_only: bool,
    /// Name of each image by address; `None` when it was skipped, so it is read and warned once.
    known_images: HashMap<usize, Option<String>>,
}

/// One Markdown block; consecutive list items are joined without a blank line.
struct Block {
    text: String,
    item: bool,
}

fn convert_page(page: &Page) -> (OneNotePage, Vec<String>) {
    let mut body = Body::default();
    let strokes = ink::page_strokes(page);
    let ink = if strokes.is_empty() {
        Vec::new()
    } else {
        ink_pages(page, &strokes, &mut body)
    };
    // Handwriting is imported as strokes only: OneNote's recognised text would
    // repeat it, so it is left out.
    let markdown = if ink.is_empty() {
        for content in page.contents() {
            push_content(content, &mut body);
        }
        render(&body.blocks)
    } else {
        String::new()
    };

    let title = page
        .title_text()
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .unwrap_or("Untitled page")
        .to_string();
    let level = u32::try_from(page.level().max(0)).unwrap_or(0);
    let layout = page_layout(page, &mut body);

    let converted = OneNotePage {
        title,
        level,
        markdown,
        images: body.images,
        ink,
        layout,
    };
    (converted, body.warnings)
}

fn push_content(content: &PageContent, body: &mut Body) {
    match content {
        PageContent::Outline(outline) => walk_outline(outline, body),
        PageContent::Image(image) => push_image(image, body),
        PageContent::EmbeddedFile(file) => push_attachment(file, body),
        _ => {}
    }
}

/// Ink pages for a page with handwriting. Each background image (a printout
/// page) starts a band down the OneNote page; every band becomes its own ink
/// pages with the image under the strokes and the band's typed text on its
/// first page. Empty when no stroke has a point.
fn ink_pages(page: &Page, strokes: &[ink::RawStroke], body: &mut Body) -> Vec<OneNoteInkPage> {
    let mut backgrounds: Vec<(ink::Rect, String)> = page
        .contents()
        .iter()
        .filter_map(|content| match content {
            PageContent::Image(image) if image.is_background() => Some(image),
            _ => None,
        })
        .filter_map(|image| Some((background_rect(image), add_image_file(image, body)?)))
        .collect();
    backgrounds.sort_by(|a, b| a.0.y.total_cmp(&b.0.y));
    let bands: Vec<ink::Rect> = backgrounds.iter().map(|(rect, _)| *rect).collect();
    let sheets = ink::build_sheets(strokes, &bands);
    if sheets.is_empty() {
        return Vec::new();
    }

    let tops: Vec<f64> = bands.iter().map(|band| band.y).collect();
    let mut texts = vec![String::new(); bands.len().max(1)];
    for (group, text) in texts.iter_mut().enumerate() {
        body.blocks.clear();
        for content in page.contents() {
            let top = match content {
                PageContent::Outline(outline) => outline.offset_vertical(),
                PageContent::Image(image) if !image.is_background() => image.offset_vertical(),
                PageContent::EmbeddedFile(file) => file.offset_vertical(),
                _ => continue,
            };
            let band = top.map_or(0, |y| {
                ink::band_index(&tops, f64::from(y) * ink::HALF_INCH_TENTHS_MM)
            });
            if band == group {
                push_content(content, body);
            }
        }
        *text = render(&body.blocks);
    }
    body.blocks.clear();

    sheets
        .into_iter()
        .map(|sheet| OneNoteInkPage {
            page: sheet.page,
            background: sheet.background.map(|rect| OneNoteBackground {
                name: backgrounds[sheet.group].1.clone(),
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
            }),
            origin_x: sheet.origin_x,
            origin_y: sheet.origin_y,
            // Only a band's first page gets its text; the take leaves "" behind.
            text: std::mem::take(&mut texts[sheet.group]),
        })
        .collect()
}

/// Positioned pieces of a page for its freeform view: outline text and the
/// images on the page, in page order. Ink is not a piece: it is drawn as strokes.
fn page_layout(page: &Page, body: &mut Body) -> Vec<OneNoteLayoutItem> {
    let mut items = Vec::new();
    for content in page.contents() {
        match content {
            PageContent::Outline(outline) => push_outline_layout(outline, body, &mut items),
            // A background printout is part of its ink, not a piece of its own.
            PageContent::Image(image) if !image.is_background() => {
                push_image_layout(image, body, &mut items);
            }
            _ => {}
        }
    }
    items
}

fn push_outline_layout(outline: &Outline, body: &mut Body, items: &mut Vec<OneNoteLayoutItem>) {
    let mut text = Body {
        text_only: true,
        ..Body::default()
    };
    walk_outline(outline, &mut text);
    let markdown = render(&text.blocks);
    if !markdown.is_empty() {
        let (x, y, width, height) = placement(
            outline.offset_horizontal(),
            outline.offset_vertical(),
            outline.layout_max_width(),
            outline.layout_max_height(),
            None,
            None,
        );
        items.push(OneNoteLayoutItem {
            kind: LayoutKind::Text,
            key: String::new(),
            text: markdown,
            x,
            y,
            width,
            height,
        });
    }
    let mut images = Vec::new();
    outline_images(outline.items(), &mut images);
    for image in images {
        push_image_layout(image, body, items);
    }
}

/// Every image inside an outline, at any depth.
fn outline_images<'a>(items: &'a [OutlineItem], out: &mut Vec<&'a Image>) {
    for item in items {
        match item {
            OutlineItem::Group(group) => outline_images(group.outlines(), out),
            OutlineItem::Element(element) => {
                out.extend(
                    element
                        .contents()
                        .iter()
                        .filter_map(|content| match content {
                            Content::Image(image) => Some(image),
                            _ => None,
                        }),
                );
                outline_images(element.children(), out);
            }
        }
    }
}

fn push_image_layout(image: &Image, body: &mut Body, items: &mut Vec<OneNoteLayoutItem>) {
    let Some(name) = add_image_file(image, body) else {
        return;
    };
    let (x, y, width, height) = placement(
        image.offset_horizontal(),
        image.offset_vertical(),
        image.layout_max_width(),
        image.layout_max_height(),
        image.picture_width(),
        image.picture_height(),
    );
    items.push(OneNoteLayoutItem {
        kind: LayoutKind::Image,
        key: name,
        text: image_alt(image),
        x,
        y,
        width,
        height,
    });
}

/// Geometry in 0.1 mm. Offsets and layout sizes are half inches and picture
/// sizes are inches; a value that is not finite counts as missing.
fn placement(
    x: Option<f32>,
    y: Option<f32>,
    layout_width: Option<f32>,
    layout_height: Option<f32>,
    picture_width: Option<f32>,
    picture_height: Option<f32>,
) -> (Option<f64>, Option<f64>, Option<f64>, Option<f64>) {
    let half = ink::HALF_INCH_TENTHS_MM;
    let inch = 2.0 * half;
    let scaled = |value: Option<f32>, unit: f64| {
        value.map(|v| f64::from(v) * unit).filter(|v| v.is_finite())
    };
    (
        scaled(x, half),
        scaled(y, half),
        scaled(layout_width, half).or_else(|| scaled(picture_width, inch)),
        scaled(layout_height, half).or_else(|| scaled(picture_height, inch)),
    )
}

/// Where a background image sits on the OneNote page, in 0.1 mm.
fn background_rect(image: &Image) -> ink::Rect {
    let half_inch = ink::HALF_INCH_TENTHS_MM;
    let offset = |value: Option<f32>| value.map_or(0.0, |v| f64::from(v) * half_inch);
    // Layout sizes are in half-inches, picture sizes in inches.
    let size = |layout: Option<f32>, picture: Option<f32>, fallback: f64| {
        layout
            .map(|v| f64::from(v) * half_inch)
            .or_else(|| picture.map(|v| f64::from(v) * 2.0 * half_inch))
            .unwrap_or(fallback)
    };
    ink::Rect {
        x: offset(image.offset_horizontal()),
        y: offset(image.offset_vertical()),
        width: size(
            image.layout_max_width(),
            image.picture_width(),
            INK_A4_WIDTH,
        ),
        height: size(
            image.layout_max_height(),
            image.picture_height(),
            INK_A4_HEIGHT,
        ),
    }
}

fn walk_outline(outline: &Outline, body: &mut Body) {
    walk_items(outline.items(), 0, body);
}

fn walk_items(items: &[OutlineItem], depth: usize, body: &mut Body) {
    for item in items {
        match item {
            OutlineItem::Group(group) => walk_items(group.outlines(), depth, body),
            OutlineItem::Element(element) => walk_element(element, depth, body),
        }
    }
}

fn walk_element(element: &OutlineElement, depth: usize, body: &mut Body) {
    let is_item = !element.list_contents().is_empty();
    for content in element.contents() {
        match content {
            Content::RichText(rich) => push_rich_text(rich, is_item, depth, body),
            Content::Table(table) => push_table(table, body),
            Content::Image(image) => push_image(image, body),
            Content::EmbeddedFile(file) => push_attachment(file, body),
            _ => {}
        }
    }
    walk_items(element.children(), depth + 1, body);
}

fn push_rich_text(rich: &RichText, is_item: bool, depth: usize, body: &mut Body) {
    let text = normalise_breaks(&rich_markdown(rich));
    let text = text.trim();
    if text.is_empty() {
        return;
    }
    if is_item {
        let indent = "  ".repeat(depth);
        // Continuation lines align under the list text.
        let continued = text.replace('\n', format!("\n{indent}  ").as_str());
        body.blocks.push(Block {
            text: format!("{indent}- {continued}"),
            item: true,
        });
    } else {
        body.blocks.push(Block {
            text: text
                .split('\n')
                .map(escape_leading)
                .collect::<Vec<_>>()
                .join("\n"),
            item: false,
        });
    }
}

const HYPERLINK_MARKER: &str = "\u{fddf}HYPERLINK \"";

/// Rich text with OneNote's hidden link markers removed and safe links as `[text](url)`.
fn rich_markdown(rich: &RichText) -> String {
    let text = rich.text();
    let links: Vec<(u32, u32, String)> = rich
        .hyperlinks()
        .iter()
        .filter_map(|link| safe_link(link.target()).map(|url| (link.start(), link.end(), url)))
        .collect();
    let hidden = marker_ranges(text);

    let mut out = String::with_capacity(text.len());
    let mut unit: u32 = 0;
    for (byte, ch) in text.char_indices() {
        let width = u32::try_from(ch.len_utf16()).unwrap_or(1);
        if !hidden.iter().any(|range| range.contains(&byte)) {
            if links.iter().any(|(start, _, _)| *start == unit) {
                out.push('[');
            }
            out.push(ch);
            if let Some((_, _, url)) = links.iter().find(|(_, end, _)| *end == unit + width) {
                out.push_str("](");
                out.push_str(url);
                out.push(')');
            }
        }
        unit += width;
    }
    out
}

/// Byte ranges of the hidden `\u{fddf}HYPERLINK "target"` markers.
fn marker_ranges(text: &str) -> Vec<std::ops::Range<usize>> {
    let mut ranges = Vec::new();
    let mut from = 0;
    while let Some(found) = text
        .get(from..)
        .and_then(|rest| rest.find(HYPERLINK_MARKER))
    {
        let start = from + found;
        let target = start + HYPERLINK_MARKER.len();
        let end = text
            .get(target..)
            .and_then(|rest| rest.find('"'))
            .map_or(text.len(), |close| target + close + 1);
        ranges.push(start..end);
        from = end;
    }
    ranges
}

/// `http`, `https` and `mailto` targets, with spaces and parentheses encoded.
fn safe_link(target: &str) -> Option<String> {
    let target = target.trim();
    let lower = target.to_ascii_lowercase();
    let allowed = ["http://", "https://", "mailto:"]
        .iter()
        .any(|scheme| lower.starts_with(scheme));
    allowed.then(|| {
        target
            .replace(' ', "%20")
            .replace('(', "%28")
            .replace(')', "%29")
    })
}

fn normalise_breaks(text: &str) -> String {
    text.replace("\r\n", "\n").replace(['\r', '\u{b}'], "\n")
}

/// Backslash-escapes a leading Markdown marker so the line stays text.
fn escape_leading(line: &str) -> String {
    if matches!(line.chars().next(), Some('#' | '>' | '-' | '+' | '*')) {
        return format!("\\{line}");
    }
    let rest = line.trim_start_matches(|c: char| c.is_ascii_digit());
    let digits = line.len() - rest.len();
    if digits > 0 && rest.starts_with('.') {
        let head = line.get(..digits).unwrap_or_default();
        return format!("{head}\\{rest}");
    }
    line.to_string()
}

fn push_table(table: &Table, body: &mut Body) {
    let rows: Vec<Vec<String>> = table
        .contents()
        .iter()
        .map(|row| {
            row.contents()
                .iter()
                .map(|cell| cell_text(cell.contents()))
                .collect()
        })
        .collect();
    let cols = rows.iter().map(Vec::len).max().unwrap_or(0);
    if cols == 0 {
        return;
    }

    let mut lines = Vec::new();
    for (index, row) in rows.iter().enumerate() {
        let cells: Vec<String> = (0..cols)
            .map(|col| row.get(col).cloned().unwrap_or_default())
            .collect();
        lines.push(format!("| {} |", cells.join(" | ")));
        if index == 0 {
            lines.push(format!("| {} |", vec!["---"; cols].join(" | ")));
        }
    }
    body.blocks.push(Block {
        text: lines.join("\n"),
        item: false,
    });
}

/// Plain text of a table cell with pipes escaped and line breaks flattened.
fn cell_text(elements: &[OutlineElement]) -> String {
    let text = elements
        .iter()
        .flat_map(OutlineElement::contents)
        .filter_map(|content| match content {
            Content::RichText(rich) => Some(rich_markdown(rich)),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join(" ");
    text.replace(['\r', '\n', '\u{b}'], " ")
        .replace('|', "\\|")
        .trim()
        .to_string()
}

fn push_image(image: &Image, body: &mut Body) {
    if body.text_only {
        return;
    }
    if let Some(name) = add_image_file(image, body) {
        body.blocks.push(Block {
            text: format!("![{}]({name})", image_alt(image)),
            item: false,
        });
    }
}

/// Copies `image` into the page's images once and returns its name, or warns
/// and returns `None` when it is too large or unreadable.
fn add_image_file(image: &Image, body: &mut Body) -> Option<String> {
    let key = std::ptr::from_ref(image) as usize;
    if let Some(known) = body.known_images.get(&key) {
        return known.clone();
    }
    let name = store_image(image, body);
    let _previous = body.known_images.insert(key, name.clone());
    name
}

fn store_image(image: &Image, body: &mut Body) -> Option<String> {
    let name_hint = image.image_filename().unwrap_or("image").to_string();
    if image.size().is_some_and(|size| size > IMAGE_MAX_BYTES) {
        body.warnings
            .push(format!("image {name_hint} skipped: larger than 20 MiB"));
        return None;
    }
    let Some(reader) = image.read() else {
        body.warnings
            .push(format!("image {name_hint} skipped: unreadable"));
        return None;
    };
    let mut bytes = Vec::new();
    let mut limited = reader.take(IMAGE_MAX_BYTES + 1);
    if limited.read_to_end(&mut bytes).is_err() {
        body.warnings
            .push(format!("image {name_hint} skipped: unreadable"));
        return None;
    }
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > IMAGE_MAX_BYTES {
        body.warnings
            .push(format!("image {name_hint} skipped: larger than 20 MiB"));
        return None;
    }

    let number = body.images.len() + 1;
    let name = format!("image-{number}.{}", image_extension(image.extension()));
    body.images.push(OneNoteImage {
        name: name.clone(),
        alt: image_alt(image),
        base64: encode_base64(&bytes),
    });
    Some(name)
}

/// Alt text with brackets and line breaks removed.
fn image_alt(image: &Image) -> String {
    image
        .alt_text()
        .unwrap_or("")
        .replace(['[', ']', '\r', '\n'], " ")
        .trim()
        .to_string()
}

/// Lower-case extension of at most five `[a-z0-9]` characters, else `png`.
fn image_extension(extension: Option<&str>) -> String {
    let ext = extension
        .map(|e| e.trim_start_matches('.').to_ascii_lowercase())
        .unwrap_or_default();
    let valid = (1..=5).contains(&ext.len())
        && ext
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit());
    if valid {
        ext
    } else {
        "png".to_string()
    }
}

fn push_attachment(file: &EmbeddedFile, body: &mut Body) {
    let filename = file.filename().to_string();
    body.warnings
        .push(format!("attachment not imported: {filename}"));
    body.blocks.push(Block {
        text: format!("*Attachment not imported: {filename}*"),
        item: false,
    });
}

/// Joins blocks with blank lines, except between consecutive list items.
fn render(blocks: &[Block]) -> String {
    let mut out = String::new();
    let mut previous: Option<&Block> = None;
    for block in blocks {
        if let Some(prev) = previous {
            out.push_str(if prev.item && block.item {
                "\n"
            } else {
                "\n\n"
            });
        }
        out.push_str(&block.text);
        previous = Some(block);
    }
    out.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::{freeform_page_text, LayoutKind, OneNoteLayoutItem};
    use std::collections::BTreeMap;

    #[test]
    fn freeform_page_text_places_layout_items_and_reads_back() {
        let layout = [OneNoteLayoutItem {
            kind: LayoutKind::Text,
            key: String::new(),
            text: "Hello".to_owned(),
            x: Some(10.0),
            y: Some(20.0),
            width: None,
            height: None,
        }];
        let text = freeform_page_text(&layout, &BTreeMap::new(), &[]);
        let canvas = crate::canvas::parse_canvas(&text).expect("valid canvas");
        assert_eq!(canvas.nodes.len(), 1);
        assert!(canvas.nodes[0].text.as_deref() == Some("Hello"));
        assert!(!text.contains("wfInk"));
    }

    use super::placement;

    #[test]
    fn placement_scales_offsets_and_sizes_to_tenths_of_a_millimetre() {
        // Offsets and layout sizes are half inches (127 tenths of a mm);
        // picture sizes are inches (254).
        let (x, y, w, h) = placement(Some(2.0), Some(3.0), Some(4.0), None, None, Some(1.5));
        assert_eq!((x, y), (Some(254.0), Some(381.0)));
        assert_eq!((w, h), (Some(508.0), Some(381.0)));
    }

    #[test]
    fn placement_counts_non_finite_values_as_missing() {
        let (x, y, w, h) = placement(
            Some(f32::NAN),
            Some(1.0),
            Some(f32::INFINITY),
            None,
            Some(f32::NAN),
            None,
        );
        assert_eq!(x, None);
        assert_eq!(y, Some(127.0));
        assert_eq!((w, h), (None, None));
    }
}
