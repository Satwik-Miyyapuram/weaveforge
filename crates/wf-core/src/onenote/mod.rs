//! OneNote `.one` section import: pages become Markdown, images, ink and recognised text.

use std::io::{Error, Read};

use onenote_parser::FileSystem;
use onenote_parser::Parser;
use onenote_parser::contents::{
    Content, EmbeddedFile, Image, Outline, OutlineElement, OutlineItem, RichText, Table,
};
use onenote_parser::page::{Page, PageContent};
use serde::Serialize;
use typed_path::{TypedPath, TypedPathBuf};

use crate::bytea::encode_base64;
use crate::ink::ink_page::InkPage;

mod ink;

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
    /// Page text as Markdown.
    pub markdown: String,
    /// Images referenced from `markdown`.
    pub images: Vec<OneNoteImage>,
    /// Ink pages, empty when the page has no ink.
    pub ink: Vec<InkPage>,
    /// Recognised handwriting words joined by spaces, or empty.
    pub ink_text: String,
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
}

/// One Markdown block; consecutive list items are joined without a blank line.
struct Block {
    text: String,
    item: bool,
}

fn convert_page(page: &Page) -> (OneNotePage, Vec<String>) {
    let mut body = Body::default();
    for content in page.contents() {
        match content {
            PageContent::Outline(outline) => walk_outline(outline, &mut body),
            PageContent::Image(image) => push_image(image, &mut body),
            PageContent::EmbeddedFile(file) => push_attachment(file, &mut body),
            _ => {}
        }
    }

    let title = page
        .title_text()
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .unwrap_or("Untitled page")
        .to_string();
    let level = u32::try_from(page.level().max(0)).unwrap_or(0);
    let ink_text = page
        .ink_recognition()
        .map(|recognition| {
            recognition
                .text()
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
        })
        .unwrap_or_default();

    let converted = OneNotePage {
        title,
        level,
        markdown: render(&body.blocks),
        images: body.images,
        ink: ink::page_ink(page),
        ink_text,
    };
    (converted, body.warnings)
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
    let name_hint = image.image_filename().unwrap_or("image").to_string();
    if image.size().is_some_and(|size| size > IMAGE_MAX_BYTES) {
        body.warnings
            .push(format!("image {name_hint} skipped: larger than 20 MiB"));
        return;
    }
    let Some(reader) = image.read() else {
        body.warnings
            .push(format!("image {name_hint} skipped: unreadable"));
        return;
    };
    let mut bytes = Vec::new();
    let mut limited = reader.take(IMAGE_MAX_BYTES + 1);
    if limited.read_to_end(&mut bytes).is_err() {
        body.warnings
            .push(format!("image {name_hint} skipped: unreadable"));
        return;
    }
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > IMAGE_MAX_BYTES {
        body.warnings
            .push(format!("image {name_hint} skipped: larger than 20 MiB"));
        return;
    }

    let number = body.images.len() + 1;
    let name = format!("image-{number}.{}", image_extension(image.extension()));
    let alt = image
        .alt_text()
        .unwrap_or("")
        .replace(['[', ']', '\r', '\n'], " ")
        .trim()
        .to_string();
    body.blocks.push(Block {
        text: format!("![{alt}]({name})"),
        item: false,
    });
    body.images.push(OneNoteImage {
        name,
        alt,
        base64: encode_base64(&bytes),
    });
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
    if valid { ext } else { "png".to_string() }
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
