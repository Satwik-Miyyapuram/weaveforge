//! Excalidraw import and export. Strokes and shapes become `wfInk` strokes, text and images
//! become canvas nodes, and other element types are skipped with a warning. On export, edges
//! become arrows and strokes become freedraw elements.

use super::{Canvas, CanvasEdge, CanvasNode, FreeStroke, read_ink, write_ink};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::collections::HashMap;
use std::f64::consts::TAU;

const COMPRESSED_FENCE: &str = "```compressed-json";
const JSON_FENCE: &str = "```json";
const EMBEDDED_FILES: &str = "## Embedded Files";
const BASE64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const HEAD_LENGTH: f64 = 15.0;
const HEAD_ANGLE: f64 = 0.436; // 25 degrees, in radians
/// Excalidraw draws a freedraw element with perfect-freehand `size: strokeWidth * 4.25`
/// (`getFreeDrawSvgPath` in its `renderElement.ts`), so a freedraw's drawn width is this
/// multiple of its `strokeWidth`. Lines and shapes are drawn at `strokeWidth` itself.
const FREEDRAW_SIZE: f64 = 4.25;
/// Opacity a highlighter stroke is exported with; below 100 reads back as a highlighter.
const HIGHLIGHTER_OPACITY: u8 = 40;
/// Most UTF-16 units a compressed drawing may unpack to, and most its dictionary may hold. Far
/// above any real drawing; it stops a few kB of crafted input from asking for gigabytes.
const LZ_MAX_UNITS: usize = 32 << 20;

/// An image taken from an Excalidraw file. The caller uploads it and sets the node's `file`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ExcalidrawImage {
    /// Id of the file node that shows the image.
    pub node_id: String,
    /// MIME type, such as `image/png`.
    pub mime: String,
    /// The image as a `data:` URL.
    pub data_url: String,
}

/// A canvas read from Excalidraw, with the images to upload and what was skipped.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ExcalidrawImport {
    /// Text and image nodes, plus handwriting in `wfInk`.
    pub canvas: Canvas,
    /// Images to upload. Their nodes carry an empty `file` until then. Images an Obsidian
    /// drawing keeps in the vault are not listed: their nodes already point at the vault file.
    pub images: Vec<ExcalidrawImage>,
    /// One line per skipped element or detail lost on the way.
    pub warnings: Vec<String>,
}

/// A canvas written as Excalidraw, with what could not be carried over.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ExcalidrawExport {
    /// The `.excalidraw` JSON text.
    pub json: String,
    /// One line per node, edge or detail left out.
    pub warnings: Vec<String>,
}

/// Reads an `.excalidraw` JSON file or an Obsidian `.excalidraw.md` file.
///
/// # Errors
///
/// Fails when the text is neither Excalidraw JSON nor an Excalidraw markdown drawing.
pub fn import_excalidraw(text: &str) -> Result<ExcalidrawImport, String> {
    let source = parse_source(text)?;
    let elements = source
        .root
        .get("elements")
        .and_then(Value::as_array)
        .ok_or_else(|| "not an Excalidraw file: no elements list".to_owned())?;
    let mut importer = Importer {
        files: source.root.get("files"),
        embedded: &source.embedded,
        out: ExcalidrawImport::default(),
        ink: Vec::new(),
    };
    for (index, element) in elements.iter().enumerate() {
        if element
            .get("isDeleted")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            continue;
        }
        importer.element(element, &element_id(element, index));
    }
    let Importer { mut out, ink, .. } = importer;
    write_ink(&mut out.canvas, &ink);
    Ok(out)
}

/// Writes a canvas as `.excalidraw` JSON. Image nodes listed in `images` become image
/// elements, other nodes text elements, edges arrows and strokes freedraw elements.
#[must_use]
pub fn export_excalidraw(canvas: &Canvas, images: &[ExcalidrawImage]) -> ExcalidrawExport {
    let mut elements = Vec::new();
    let mut files = Map::new();
    let mut warnings = Vec::new();
    for node in &canvas.nodes {
        match node_element(node, images, &mut files) {
            Some(element) => elements.push(element),
            None => warnings.push(format!(
                "skipped {} node {}: nothing to show",
                node.kind, node.id
            )),
        }
    }
    for edge in &canvas.edges {
        match edge_element(canvas, edge) {
            Ok(element) => elements.push(element),
            Err(warning) => warnings.push(warning),
        }
        if edge.label.as_deref().is_some_and(|label| !label.is_empty()) {
            warnings.push(format!("edge {}: label left out", edge.id));
        }
    }
    elements.extend(read_ink(canvas).iter().map(freedraw_element));
    let root = json!({
        "type": "excalidraw",
        "version": 2,
        "source": "weaveforge",
        "elements": elements,
        "appState": {"gridSize": null, "viewBackgroundColor": "#ffffff"},
        "files": files,
    });
    ExcalidrawExport {
        json: serde_json::to_string_pretty(&root).unwrap_or_default(),
        warnings,
    }
}

/// The drawing, plus the vault paths of the images an Obsidian drawing keeps as files.
struct Source {
    root: Value,
    embedded: HashMap<String, String>,
}

fn parse_source(text: &str) -> Result<Source, String> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    if text.trim_start().starts_with('{') {
        return Ok(Source {
            root: parse_json(text)?,
            embedded: HashMap::new(),
        });
    }
    Ok(Source {
        root: parse_markdown(text)?,
        embedded: embedded_files(text),
    })
}

fn parse_json(text: &str) -> Result<Value, String> {
    serde_json::from_str(text).map_err(|e| format!("not an Excalidraw file: {e}"))
}

/// Finds the drawing in an `.excalidraw.md` file: a `compressed-json` block, else a `json` block.
fn parse_markdown(text: &str) -> Result<Value, String> {
    let start = text.find("## Drawing").unwrap_or(0);
    let rest = &text[start..];
    if let Some(at) = rest.find(COMPRESSED_FENCE) {
        let body = fenced_body(&rest[at + COMPRESSED_FENCE.len()..])?;
        return parse_json(&lz_decompress_base64(&body)?);
    }
    if let Some(at) = rest.find(JSON_FENCE) {
        return parse_json(&fenced_body(&rest[at + JSON_FENCE.len()..])?);
    }
    Err("not an Excalidraw file: no drawing block".to_owned())
}

/// The text up to the closing fence, with whitespace removed (Obsidian wraps packed data).
fn fenced_body(after_tag: &str) -> Result<String, String> {
    let end = after_tag
        .find("```")
        .ok_or_else(|| "not an Excalidraw file: unclosed drawing block".to_owned())?;
    Ok(after_tag[..end]
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect())
}

/// The `<fileId>: [[path]]` (or `![[path]]`) lines of the `## Embedded Files` section, as
/// file id to vault path. The section ends at the next heading or `%%`.
fn embedded_files(text: &str) -> HashMap<String, String> {
    let Some(start) = text.find(EMBEDDED_FILES) else {
        return HashMap::new();
    };
    text[start + EMBEDDED_FILES.len()..]
        .lines()
        .skip(1)
        .take_while(|line| !line.starts_with("## ") && !line.starts_with("%%"))
        .filter_map(embedded_line)
        .collect()
}

/// One `<fileId>: [[path|size]]` line. The part after `|` is a display size, not the path.
fn embedded_line(line: &str) -> Option<(String, String)> {
    let (id, rest) = line.split_once(':')?;
    let rest = rest.trim();
    let rest = rest.strip_prefix('!').unwrap_or(rest);
    let inner = rest.strip_prefix("[[")?.split_once("]]")?.0;
    let path = inner.split('|').next().unwrap_or(inner).trim();
    let id = id.trim();
    (!id.is_empty() && !path.is_empty()).then(|| (id.to_owned(), path.to_owned()))
}

/// Reads LZ-String's `compressToBase64` output.
fn lz_decompress_base64(text: &str) -> Result<String, String> {
    let values = base64_values(text);
    if values.is_empty() {
        return Err("not an Excalidraw file: empty compressed drawing".to_owned());
    }
    let corrupt = || "not an Excalidraw file: corrupt compressed drawing".to_owned();
    let length = values.len();
    let mut reader = BitReader::new(values);
    let first = match reader.read(2) {
        0 => vec![unit(reader.read(8))],
        1 => vec![unit(reader.read(16))],
        _ => return Ok(String::new()),
    };
    let mut dictionary = LzDictionary {
        entries: vec![vec![0], vec![1], vec![2], first.clone()],
        num_bits: 3,
        enlarge_in: 4,
    };
    let mut output = first.clone();
    let mut previous = first;
    let mut dictionary_units = 0;
    loop {
        if reader.index > length {
            return Err(corrupt());
        }
        let code = match reader.read(dictionary.num_bits) {
            literal @ (0 | 1) => {
                let width = if literal == 0 { 8 } else { 16 };
                dictionary.entries.push(vec![unit(reader.read(width))]);
                dictionary.grow();
                dictionary.entries.len() - 1
            }
            2 => return Ok(String::from_utf16_lossy(&output)),
            other => usize::try_from(other).unwrap_or(usize::MAX),
        };
        let entry = dictionary.entry(code, &previous).ok_or_else(corrupt)?;
        dictionary_units += previous.len() + 2;
        if output.len() + entry.len() > LZ_MAX_UNITS || dictionary_units > LZ_MAX_UNITS {
            return Err(corrupt());
        }
        output.extend_from_slice(&entry);
        let mut added = previous;
        added.push(entry[0]);
        dictionary.entries.push(added);
        dictionary.grow();
        previous = entry;
    }
}

/// The 6-bit value of each base64 character; padding and unknown characters read as 0.
fn base64_values(text: &str) -> Vec<u32> {
    text.chars()
        .map(|c| {
            BASE64
                .iter()
                .position(|&b| char::from(b) == c)
                .map_or(0, |i| u32::try_from(i).unwrap_or(0))
        })
        .collect()
}

/// LZ-String's dictionary and the width of the next code.
struct LzDictionary {
    entries: Vec<Vec<u16>>,
    num_bits: u32,
    enlarge_in: u32,
}

impl LzDictionary {
    /// Counts one more entry, widening the codes when the current width is used up.
    fn grow(&mut self) {
        self.enlarge_in -= 1;
        if self.enlarge_in == 0 {
            self.enlarge_in = 1 << self.num_bits;
            self.num_bits += 1;
        }
    }

    /// The text of `code`. The one code not yet in the dictionary is the entry being built:
    /// the previous text plus its own first unit.
    fn entry(&self, code: usize, previous: &[u16]) -> Option<Vec<u16>> {
        if let Some(entry) = self.entries.get(code) {
            return Some(entry.clone());
        }
        if code != self.entries.len() {
            return None;
        }
        let mut entry = previous.to_vec();
        entry.push(*previous.first()?);
        Some(entry)
    }
}

fn unit(bits: u32) -> u16 {
    u16::try_from(bits).unwrap_or(0)
}

/// Reads LZ-String's packed bits: 6 per character, most significant bit of each character first.
struct BitReader {
    values: Vec<u32>,
    index: usize,
    value: u32,
    position: u32,
}

impl BitReader {
    fn new(values: Vec<u32>) -> Self {
        let value = values.first().copied().unwrap_or(0);
        Self {
            values,
            index: 1,
            value,
            position: 32,
        }
    }

    fn next_value(&self, index: usize) -> u32 {
        self.values.get(index).copied().unwrap_or(0)
    }

    /// Reads `count` bits, least significant first, as LZ-String does.
    fn read(&mut self, count: u32) -> u32 {
        let mut bits = 0;
        let mut power = 1;
        while power != 1 << count {
            let set = (self.value & self.position) != 0;
            self.position >>= 1;
            if self.position == 0 {
                self.position = 32;
                self.value = self.next_value(self.index);
                self.index += 1;
            }
            if set {
                bits |= power;
            }
            power <<= 1;
        }
        bits
    }
}

/// Collects the nodes, strokes and warnings of one import.
struct Importer<'a> {
    files: Option<&'a Value>,
    embedded: &'a HashMap<String, String>,
    out: ExcalidrawImport,
    ink: Vec<FreeStroke>,
}

impl Importer<'_> {
    fn element(&mut self, element: &Value, id: &str) {
        let kind = str_of(element, "type");
        match kind {
            "text" => {
                self.warn_if_rotated(element, "text", id);
                let mut node = canvas_node(id, "text", element);
                node.text = Some(str_of(element, "text").to_owned());
                self.out.canvas.nodes.push(node);
            }
            "image" => self.image(element, id),
            "freedraw" => self.ink.push(freedraw_stroke(element, id)),
            "rectangle" | "ellipse" | "diamond" => {
                self.ink.push(shape_stroke(kind, element, id));
            }
            "line" | "arrow" => self.ink.extend(line_strokes(kind, element, id)),
            other => self.out.warnings.push(format!("skipped {other}")),
        }
    }

    /// An image with its data in the file becomes a node to upload into; one an Obsidian
    /// drawing keeps in the vault becomes a node on that vault path.
    fn image(&mut self, element: &Value, id: &str) {
        let file_id = str_of(element, "fileId");
        let entry = self.files.and_then(|files| files.get(file_id));
        let mut node = canvas_node(id, "file", element);
        if let Some(data_url) = entry
            .and_then(|entry| entry.get("dataURL"))
            .and_then(Value::as_str)
        {
            let mime = entry
                .and_then(|entry| entry.get("mimeType"))
                .and_then(Value::as_str)
                .unwrap_or("application/octet-stream");
            node.file = Some(String::new());
            self.out.images.push(ExcalidrawImage {
                node_id: id.to_owned(),
                mime: mime.to_owned(),
                data_url: data_url.to_owned(),
            });
        } else if let Some(path) = self.embedded.get(file_id) {
            node.file = Some(path.clone());
        } else {
            self.out
                .warnings
                .push(format!("skipped image {id}: file {file_id} is missing"));
            return;
        }
        self.warn_if_rotated(element, "image", id);
        self.out.canvas.nodes.push(node);
    }

    /// Canvas nodes cannot turn, so a turned text or image arrives upright.
    fn warn_if_rotated(&mut self, element: &Value, kind: &str, id: &str) {
        if angle_of(element).abs() > f64::EPSILON {
            self.out
                .warnings
                .push(format!("{kind} {id} was rotated; imported upright"));
        }
    }
}

/// The element's id, or `exc-<index>` when it has none.
fn element_id(element: &Value, index: usize) -> String {
    match str_of(element, "id") {
        "" => format!("exc-{index}"),
        id => id.to_owned(),
    }
}

/// Converts an Excalidraw element into a canvas node of the given kind.
fn canvas_node(id: &str, kind: &str, element: &Value) -> CanvasNode {
    CanvasNode {
        id: id.to_owned(),
        kind: kind.to_owned(),
        x: num_of(element, "x").round(),
        y: num_of(element, "y").round(),
        width: num_of(element, "width").round(),
        height: num_of(element, "height").round(),
        ..CanvasNode::default()
    }
}

/// How a stroke is drawn.
struct Style<'a> {
    width: f64,
    color: &'a str,
    tool: &'static str,
}

fn line_style(element: &Value) -> Style<'_> {
    Style {
        width: width_of(element),
        color: color_of(element),
        tool: "pen",
    }
}

/// A freedraw, turned by its angle. A see-through one is a highlighter.
fn freedraw_stroke(element: &Value, id: &str) -> FreeStroke {
    let simulated = element
        .get("simulatePressure")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let pressure = if simulated {
        Vec::new()
    } else {
        pressures_of(element)
    };
    let opacity = element
        .get("opacity")
        .and_then(Value::as_f64)
        .unwrap_or(100.0);
    let style = Style {
        width: (width_of(element) * FREEDRAW_SIZE * 100.0).round() / 100.0,
        color: color_of(element),
        tool: if opacity < 100.0 {
            "highlighter"
        } else {
            "pen"
        },
    };
    let points = element_points(element);
    let points = rotated(&points, points_centre(&points), angle_of(element));
    stroke(id, origin(element), &points, &pressure, &style)
}

/// The outline of a rectangle, ellipse or diamond, turned about its centre.
fn shape_stroke(kind: &str, element: &Value, id: &str) -> FreeStroke {
    let (x, y) = (num_of(element, "x"), num_of(element, "y"));
    let (w, h) = (num_of(element, "width"), num_of(element, "height"));
    let points = rotated(
        &outline(kind, x, y, w, h),
        (x + w / 2.0, y + h / 2.0),
        angle_of(element),
    );
    stroke(id, origin(element), &points, &[], &line_style(element))
}

/// A line or arrow and its heads. A missing head field means Excalidraw's default (an arrow
/// head at the end of an arrow, none on a line); `null` means none.
fn line_strokes(kind: &str, element: &Value, id: &str) -> Vec<FreeStroke> {
    let points = element_points(element);
    let points = rotated(&points, points_centre(&points), angle_of(element));
    if points.is_empty() {
        return Vec::new();
    }
    let (anchor, style) = (origin(element), line_style(element));
    let mut strokes = vec![stroke(id, anchor, &points, &[], &style)];
    if has_head(element, "endArrowhead", kind == "arrow")
        && let Some(head) = arrow_head(&points)
    {
        strokes.push(stroke(&format!("{id}-head"), anchor, &head, &[], &style));
    }
    let reversed: Vec<(f64, f64)> = points.iter().rev().copied().collect();
    if has_head(element, "startArrowhead", false)
        && let Some(head) = arrow_head(&reversed)
    {
        strokes.push(stroke(&format!("{id}-start"), anchor, &head, &[], &style));
    }
    strokes
}

fn has_head(element: &Value, key: &str, default: bool) -> bool {
    match element.get(key) {
        None => default,
        Some(head) => !head.is_null(),
    }
}

/// One `wfInk` stroke. Points are absolute and stored as 0.1 px offsets from `anchor`.
fn stroke(
    id: &str,
    anchor: (f64, f64),
    points: &[(f64, f64)],
    pressure: &[u8],
    style: &Style<'_>,
) -> FreeStroke {
    FreeStroke {
        id: id.to_owned(),
        x: anchor.0,
        y: anchor.1,
        w: style.width,
        c: style.color.to_owned(),
        t: style.tool.to_owned(),
        p: points
            .iter()
            .flat_map(|&(x, y)| [to_tenths(x - anchor.0), to_tenths(y - anchor.1)])
            .collect(),
        r: pressure.to_vec(),
        extra: Map::new(),
    }
}

/// `points` turned by `angle` (radians, clockwise on screen) about `centre`, as Excalidraw
/// turns an element.
fn rotated(points: &[(f64, f64)], centre: (f64, f64), angle: f64) -> Vec<(f64, f64)> {
    if angle.abs() <= f64::EPSILON || !angle.is_finite() {
        return points.to_vec();
    }
    let (sin, cos) = angle.sin_cos();
    points
        .iter()
        .map(|&(x, y)| {
            let (dx, dy) = (x - centre.0, y - centre.1);
            (
                centre.0 + dx * cos - dy * sin,
                centre.1 + dx * sin + dy * cos,
            )
        })
        .collect()
}

/// The middle of the box around `points`; Excalidraw turns a line about it.
fn points_centre(points: &[(f64, f64)]) -> (f64, f64) {
    let (min_x, max_x, min_y, max_y) = bounds(points);
    ((min_x + max_x) / 2.0, (min_y + max_y) / 2.0)
}

/// `(min_x, max_x, min_y, max_y)` of `points`; all 0 when there are none.
fn bounds(points: &[(f64, f64)]) -> (f64, f64, f64, f64) {
    let Some(&(x, y)) = points.first() else {
        return (0.0, 0.0, 0.0, 0.0);
    };
    points
        .iter()
        .fold((x, x, y, y), |(lo_x, hi_x, lo_y, hi_y), &(x, y)| {
            (lo_x.min(x), hi_x.max(x), lo_y.min(y), hi_y.max(y))
        })
}

#[allow(
    clippy::cast_possible_truncation,
    reason = "clamped to the i32 range before the cast"
)]
fn to_tenths(value: f64) -> i32 {
    (value * 10.0)
        .round()
        .clamp(f64::from(i32::MIN), f64::from(i32::MAX)) as i32
}

#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "clamped to 0..=255 before the cast"
)]
fn to_byte(value: f64) -> u8 {
    (value * 255.0).round().clamp(0.0, 255.0) as u8
}

fn origin(element: &Value) -> (f64, f64) {
    (num_of(element, "x").round(), num_of(element, "y").round())
}

/// Absolute points of a freedraw, line or arrow element.
fn element_points(element: &Value) -> Vec<(f64, f64)> {
    let (x, y) = (num_of(element, "x"), num_of(element, "y"));
    element
        .get("points")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|point| {
            let pair = point.as_array()?;
            Some((x + pair.first()?.as_f64()?, y + pair.get(1)?.as_f64()?))
        })
        .collect()
}

fn pressures_of(element: &Value) -> Vec<u8> {
    element
        .get("pressures")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|v| to_byte(v.as_f64().unwrap_or(0.0)))
        .collect()
}

/// Absolute outline of a rectangle, diamond or ellipse (ellipse: 32 segments).
fn outline(kind: &str, x: f64, y: f64, w: f64, h: f64) -> Vec<(f64, f64)> {
    match kind {
        "rectangle" => vec![(x, y), (x + w, y), (x + w, y + h), (x, y + h), (x, y)],
        "diamond" => vec![
            (x + w / 2.0, y),
            (x + w, y + h / 2.0),
            (x + w / 2.0, y + h),
            (x, y + h / 2.0),
            (x + w / 2.0, y),
        ],
        _ => (0..=32)
            .map(|i| {
                let t = TAU * f64::from(i) / 32.0;
                (
                    x + w / 2.0 + w / 2.0 * t.cos(),
                    y + h / 2.0 + h / 2.0 * t.sin(),
                )
            })
            .collect(),
    }
}

/// The two barbs of an arrow head, at the last point, as one open stroke through the tip.
fn arrow_head(points: &[(f64, f64)]) -> Option<Vec<(f64, f64)>> {
    let n = points.len();
    if n < 2 {
        return None;
    }
    let (tip, prev) = (points[n - 1], points[n - 2]);
    let (dx, dy) = (tip.0 - prev.0, tip.1 - prev.1);
    let length = dx.hypot(dy);
    if length < f64::EPSILON {
        return None;
    }
    let (back_x, back_y) = (-dx / length, -dy / length);
    let barb = |angle: f64| {
        let (sin, cos) = angle.sin_cos();
        (
            tip.0 + HEAD_LENGTH * (back_x * cos - back_y * sin),
            tip.1 + HEAD_LENGTH * (back_x * sin + back_y * cos),
        )
    };
    Some(vec![barb(HEAD_ANGLE), tip, barb(-HEAD_ANGLE)])
}

/// The element for a node, or `None` when the node has nothing Excalidraw can show. An image
/// listed in `images` also adds its data to `files`.
fn node_element(
    node: &CanvasNode,
    images: &[ExcalidrawImage],
    files: &mut Map<String, Value>,
) -> Option<Value> {
    if node.kind == "file"
        && let Some(image) = images.iter().find(|image| image.node_id == node.id)
    {
        let _ = files.insert(
            node.id.clone(),
            json!({
                "mimeType": image.mime,
                "id": node.id,
                "dataURL": image.data_url,
                "created": 1,
            }),
        );
        return Some(image_element(node));
    }
    let text = match node.kind.as_str() {
        "text" => Some(node.text.clone().unwrap_or_default()),
        "file" => node.file.clone(),
        "link" => node.url.clone(),
        "group" => node.label.clone(),
        _ => None,
    }
    .filter(|text| node.kind == "text" || !text.is_empty())?;
    Some(text_element(node, &text))
}

fn text_element(node: &CanvasNode, text: &str) -> Value {
    let mut element = base(&node.id, "text", rect(node));
    element["text"] = json!(text);
    element["originalText"] = json!(text);
    element["fontSize"] = json!(20);
    element["fontFamily"] = json!(1);
    element["textAlign"] = json!("left");
    element["verticalAlign"] = json!("top");
    element["containerId"] = Value::Null;
    element["lineHeight"] = json!(1.25);
    element["autoResize"] = json!(true);
    element
}

fn image_element(node: &CanvasNode) -> Value {
    let mut element = base(&node.id, "image", rect(node));
    element["fileId"] = json!(node.id);
    element["status"] = json!("saved");
    element["scale"] = json!([1, 1]);
    element["crop"] = Value::Null;
    element
}

/// An unbound arrow from the side of one node to the side of the other, with the edge's ends.
fn edge_element(canvas: &Canvas, edge: &CanvasEdge) -> Result<Value, String> {
    let find = |id: &str| canvas.nodes.iter().find(|node| node.id == id);
    let (Some(from), Some(to)) = (find(&edge.from_node), find(&edge.to_node)) else {
        return Err(format!(
            "skipped edge {}: a node it joins is missing",
            edge.id
        ));
    };
    let start = side_point(from, edge.from_side.as_deref());
    let end = side_point(to, edge.to_side.as_deref());
    let (dx, dy) = (finite(end.0 - start.0), finite(end.1 - start.1));
    let mut element = base(&edge.id, "arrow", (start.0, start.1, dx.abs(), dy.abs()));
    element["points"] = json!([[0.0, 0.0], [dx, dy]]);
    element["startArrowhead"] = head(edge.from_end.as_deref(), false);
    element["endArrowhead"] = head(edge.to_end.as_deref(), true);
    element["startBinding"] = Value::Null;
    element["endBinding"] = Value::Null;
    element["lastCommittedPoint"] = Value::Null;
    if let Some(color) = edge.color.as_deref().filter(|c| c.starts_with('#')) {
        element["strokeColor"] = json!(color);
    }
    Ok(element)
}

/// The middle of a node's side, or its centre when no side is given.
fn side_point(node: &CanvasNode, side: Option<&str>) -> (f64, f64) {
    let (x, y, w, h) = rect(node);
    match side {
        Some("top") => (x + w / 2.0, y),
        Some("right") => (x + w, y + h / 2.0),
        Some("bottom") => (x + w / 2.0, y + h),
        Some("left") => (x, y + h / 2.0),
        _ => (x + w / 2.0, y + h / 2.0),
    }
}

/// An Excalidraw arrowhead for a JSON Canvas edge end (`arrow` or `none`).
fn head(end: Option<&str>, default: bool) -> Value {
    if end.map_or(default, |end| end == "arrow") {
        json!("arrow")
    } else {
        Value::Null
    }
}

/// A stroke as a freedraw element whose origin is its first point, as Excalidraw draws them.
fn freedraw_element(stroke: &FreeStroke) -> Value {
    let points: Vec<(f64, f64)> = stroke
        .p
        .as_chunks::<2>()
        .0
        .iter()
        .map(|&[dx, dy]| (f64::from(dx) / 10.0, f64::from(dy) / 10.0))
        .collect();
    let first = points.first().copied().unwrap_or((0.0, 0.0));
    let relative: Vec<(f64, f64)> = points
        .iter()
        .map(|&(x, y)| (x - first.0, y - first.1))
        .collect();
    let (min_x, max_x, min_y, max_y) = bounds(&relative);
    let pressures: Vec<f64> = stroke.r.iter().map(|&r| f64::from(r) / 255.0).collect();
    let mut element = base(
        &stroke.id,
        "freedraw",
        (
            stroke.x + first.0,
            stroke.y + first.1,
            max_x - min_x,
            max_y - min_y,
        ),
    );
    element["strokeColor"] = json!(stroke.c);
    element["strokeWidth"] = json!(finite(stroke.w / FREEDRAW_SIZE));
    element["points"] = json!(relative);
    element["simulatePressure"] = json!(pressures.is_empty());
    element["pressures"] = json!(pressures);
    element["lastCommittedPoint"] = Value::Null;
    if stroke.t == "highlighter" {
        element["opacity"] = json!(HIGHLIGHTER_OPACITY);
    }
    element
}

/// An Excalidraw element with the fields Excalidraw requires. The seed comes from the id, so
/// exports are stable.
fn base(id: &str, kind: &str, (x, y, width, height): (f64, f64, f64, f64)) -> Value {
    json!({
        "id": id,
        "type": kind,
        "x": finite(x),
        "y": finite(y),
        "width": finite(width),
        "height": finite(height),
        "angle": 0,
        "strokeColor": "#1e1e1e",
        "backgroundColor": "transparent",
        "fillStyle": "solid",
        "strokeWidth": 1,
        "strokeStyle": "solid",
        "roughness": 0,
        "opacity": 100,
        "groupIds": [],
        "frameId": null,
        "roundness": null,
        "seed": fnv(id),
        "version": 1,
        "versionNonce": fnv(&format!("{id}#")),
        "isDeleted": false,
        "boundElements": null,
        "updated": 1,
        "link": null,
        "locked": false,
    })
}

fn rect(node: &CanvasNode) -> (f64, f64, f64, f64) {
    (node.x, node.y, node.width, node.height)
}

/// A coordinate the canvas does not have (NaN) is written as 0 rather than `null`.
fn finite(value: f64) -> f64 {
    if value.is_finite() { value } else { 0.0 }
}

/// FNV-1a, so an element's seed does not change between exports.
fn fnv(text: &str) -> u32 {
    text.bytes().fold(0x811c_9dc5, |hash, byte| {
        (hash ^ u32::from(byte)).wrapping_mul(0x0100_0193)
    })
}

fn str_of<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or("")
}

fn num_of(value: &Value, key: &str) -> f64 {
    value.get(key).and_then(Value::as_f64).unwrap_or(0.0)
}

fn angle_of(element: &Value) -> f64 {
    num_of(element, "angle")
}

fn width_of(element: &Value) -> f64 {
    element
        .get("strokeWidth")
        .and_then(Value::as_f64)
        .unwrap_or(1.0)
}

fn color_of(element: &Value) -> &str {
    element
        .get("strokeColor")
        .and_then(Value::as_str)
        .unwrap_or("#1e1e1e")
}

#[cfg(test)]
mod tests {
    use super::super::INK_FIELD;
    use super::*;
    use serde_json::json;
    use std::f64::consts::FRAC_PI_2;

    /// Appends `value` as `count` bits, least significant first, as LZ-String writes them.
    fn put(bits: &mut Vec<bool>, value: u32, count: u32) {
        bits.extend((0..count).map(|i| ((value >> i) & 1) == 1));
    }

    /// Packed bits as LZ-String's base64 text, padded with a zero character.
    fn to_base64(mut bits: Vec<bool>) -> String {
        while !bits.len().is_multiple_of(6) {
            bits.push(false);
        }
        bits.extend([false; 6]);
        bits.chunks(6)
            .map(|chunk| {
                let value = chunk
                    .iter()
                    .fold(0_usize, |acc, &bit| acc * 2 + usize::from(bit));
                char::from(BASE64[value])
            })
            .collect()
    }

    /// The literal `a`, then `count` codes that each name the entry being built, then the end.
    fn pack_self_references(count: u32) -> String {
        let mut bits: Vec<bool> = Vec::new();
        put(&mut bits, 0, 2);
        put(&mut bits, u32::from(b'a'), 8);
        let (mut size, mut num_bits, mut enlarge_in) = (4_u32, 3_u32, 4_u32);
        for _ in 0..count {
            put(&mut bits, size, num_bits);
            size += 1;
            enlarge_in -= 1;
            if enlarge_in == 0 {
                enlarge_in = 1 << num_bits;
                num_bits += 1;
            }
        }
        put(&mut bits, 2, num_bits);
        to_base64(bits)
    }

    /// LZ-String `compressToBase64` restricted to literal tokens. Enough to build packed input.
    fn pack_literals(text: &str) -> String {
        let codes: Vec<u32> = text.chars().map(u32::from).collect();
        let mut bits: Vec<bool> = Vec::new();
        put(&mut bits, 0, 2);
        put(&mut bits, codes[0], 8);
        let (mut num_bits, mut enlarge_in) = (3_u32, 4_u32);
        for &code in &codes[1..] {
            put(&mut bits, 0, num_bits);
            put(&mut bits, code, 8);
            for _ in 0..2 {
                enlarge_in -= 1;
                if enlarge_in == 0 {
                    enlarge_in = 1 << num_bits;
                    num_bits += 1;
                }
            }
        }
        put(&mut bits, 2, num_bits);
        to_base64(bits)
    }

    fn sample_drawing(elements: Value, files: Value) -> String {
        let mut root = json!({"type": "excalidraw", "version": 2});
        root["elements"] = elements;
        root["files"] = files;
        root.to_string()
    }

    fn import_elements(elements: Value) -> ExcalidrawImport {
        import_excalidraw(&sample_drawing(elements, json!({}))).unwrap()
    }

    fn ids(strokes: &[FreeStroke]) -> Vec<&str> {
        strokes.iter().map(|s| s.id.as_str()).collect()
    }

    fn element<'a>(exported: &'a Value, id: &str) -> &'a Value {
        exported["elements"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["id"] == id)
            .unwrap()
    }

    fn pen(id: &str, x: f64, y: f64, w: f64, p: Vec<i32>) -> FreeStroke {
        FreeStroke {
            id: id.into(),
            x,
            y,
            w,
            c: "#000000".into(),
            t: "pen".into(),
            p,
            r: Vec::new(),
            extra: Map::new(),
        }
    }

    #[test]
    fn lz_string_decodes_a_known_vector() {
        // Vectors from lz-string 1.5.0 `compressToBase64`.
        assert_eq!(
            lz_decompress_base64("BYUwNmD2AEDukCcwBMg=").unwrap(),
            "hello world"
        );
        assert_eq!(
            lz_decompress_base64("BYUwNmD2AEDukCcwBMCEQ===").unwrap(),
            "hello world!"
        );
        assert_eq!(
            lz_decompress_base64(
                "N4IgLgngDgpiBcIYA8DGBDANgSwCYCd0B3EAGiUxgFsYA7MAZwQG1Q8ER0zwUwOALAJeZMAewAEgXg3AAHvj0AIwVLFKhSAC+AXXVA=="
            )
            .unwrap(),
            r#"{"type":"excalidraw","elements":[{"id":"a","text":"héllo 😀 ababababababab"}]}"#
        );
    }

    #[test]
    fn lz_string_decodes_codes_that_refer_to_the_entry_being_built() {
        // lz-string 1.5.0 `compressToBase64`. Runs make the encoder emit the code of the entry it
        // is still building (code == dictionary length).
        assert_eq!(
            lz_decompress_base64("IY1/EA==").unwrap(),
            "aaaaaaaaaaaaaaaa"
        );
        assert_eq!(
            lz_decompress_base64("IYI17SIo").unwrap(),
            "abababababababababab"
        );
    }

    #[test]
    fn freedraw_becomes_a_stroke_with_tenth_pixel_offsets_and_pressure() {
        let import = import_elements(json!([{
            "id": "ink1", "type": "freedraw", "x": 100, "y": 50,
            "strokeColor": "#e03131", "strokeWidth": 2,
            "points": [[0, 0], [1.5, -1], [3, 2]],
            "pressures": [0.5, 1.0, 0.0], "simulatePressure": false, "isDeleted": false
        }]));
        let ink = read_ink(&import.canvas);
        assert_eq!(ink.len(), 1);
        let s = &ink[0];
        assert_eq!(s.id, "ink1");
        assert_eq!((s.x, s.y), (100.0, 50.0));
        // Excalidraw draws a freedraw at strokeWidth * 4.25.
        assert_eq!(s.w, 8.5);
        assert_eq!(s.c, "#e03131");
        assert_eq!(s.t, "pen");
        assert_eq!(s.p, vec![0, 0, 15, -10, 30, 20]);
        assert_eq!(s.r, vec![128, 255, 0]);
        assert!(import.canvas.nodes.is_empty());
    }

    #[test]
    fn strokes_without_pressure_are_written_without_an_r_field() {
        let import = import_elements(json!([
            {"id": "f1", "type": "freedraw", "x": 0, "y": 0, "points": [[0, 0], [1, 1]],
             "pressures": [], "simulatePressure": true},
            {"id": "r1", "type": "rectangle", "x": 0, "y": 0, "width": 1, "height": 1}
        ]));
        let raw = import.canvas.extra[INK_FIELD].as_array().unwrap();
        assert_eq!(raw.len(), 2);
        assert!(raw.iter().all(|item| item.get("r").is_none()), "{raw:?}");
    }

    #[test]
    fn a_see_through_freedraw_is_a_highlighter() {
        let import = import_elements(json!([
            {"id": "h", "type": "freedraw", "x": 0, "y": 0, "opacity": 40, "points": [[0, 0], [5, 0]]},
            {"id": "p", "type": "freedraw", "x": 0, "y": 0, "opacity": 100, "points": [[0, 0], [5, 0]]}
        ]));
        let ink = read_ink(&import.canvas);
        assert_eq!(ink[0].t, "highlighter");
        assert_eq!(ink[1].t, "pen");
    }

    #[test]
    fn far_off_points_are_clamped_not_wrapped() {
        let import = import_elements(json!([
            {"id": "far", "type": "freedraw", "x": 0, "y": 0, "points": [[0, 0], [1e12, -1e12]]}
        ]));
        let ink = read_ink(&import.canvas);
        assert_eq!(ink[0].p, vec![0, 0, i32::MAX, i32::MIN]);
    }

    #[test]
    fn text_and_image_become_nodes_and_the_image_is_listed_for_upload() {
        let text = sample_drawing(
            json!([
                {"id": "t1", "type": "text", "x": 10, "y": 20.6, "width": 120.2, "height": 25, "text": "hello"},
                {"id": "img1", "type": "image", "x": 5, "y": 6, "width": 100, "height": 80, "fileId": "f1"}
            ]),
            json!({"f1": {"mimeType": "image/png", "id": "f1", "dataURL": "data:image/png;base64,AAAA", "created": 1}}),
        );
        let import = import_excalidraw(&text).unwrap();
        assert_eq!(import.canvas.nodes.len(), 2);
        let text_node = &import.canvas.nodes[0];
        assert_eq!(text_node.kind, "text");
        assert_eq!(text_node.text.as_deref(), Some("hello"));
        assert_eq!(
            (text_node.x, text_node.y, text_node.width, text_node.height),
            (10.0, 21.0, 120.0, 25.0)
        );
        let image_node = &import.canvas.nodes[1];
        assert_eq!(image_node.kind, "file");
        assert_eq!(image_node.file.as_deref(), Some(""));
        assert_eq!(
            import.images,
            vec![ExcalidrawImage {
                node_id: "img1".into(),
                mime: "image/png".into(),
                data_url: "data:image/png;base64,AAAA".into(),
            }]
        );
        assert!(import.warnings.is_empty());
    }

    #[test]
    fn elements_without_an_id_get_one_from_their_position() {
        let import = import_elements(json!([
            {"id": "t0", "type": "text", "x": 0, "y": 0, "width": 1, "height": 1, "text": "a"},
            {"type": "text", "x": 0, "y": 0, "width": 1, "height": 1, "text": "b"},
            {"id": "", "type": "freedraw", "x": 0, "y": 0, "points": [[0, 0]]}
        ]));
        assert_eq!(import.canvas.nodes[1].id, "exc-1");
        assert_eq!(ids(&read_ink(&import.canvas)), vec!["exc-2"]);
    }

    #[test]
    fn a_leading_byte_order_mark_is_ignored() {
        let json_text = sample_drawing(
            json!([{"id": "t1", "type": "text", "x": 0, "y": 0, "width": 1, "height": 1, "text": "bom"}]),
            json!({}),
        );
        let import = import_excalidraw(&format!("\u{feff}{json_text}")).unwrap();
        assert_eq!(import.canvas.nodes[0].text.as_deref(), Some("bom"));
        let md = format!("\u{feff}## Drawing\n```json\n{json_text}\n```\n");
        assert_eq!(
            import_excalidraw(&md).unwrap().canvas.nodes[0]
                .text
                .as_deref(),
            Some("bom")
        );
    }

    #[test]
    fn deleted_elements_vanish_and_unknown_types_warn() {
        let import = import_elements(json!([
            {"id": "gone", "type": "text", "isDeleted": true, "text": "x", "x": 0, "y": 0, "width": 1, "height": 1},
            {"id": "frame", "type": "embeddable", "isDeleted": false, "x": 0, "y": 0, "width": 1, "height": 1},
            {"id": "img2", "type": "image", "x": 0, "y": 0, "width": 1, "height": 1, "fileId": "nope"}
        ]));
        assert!(import.canvas.nodes.is_empty());
        assert_eq!(
            import.warnings,
            vec![
                "skipped embeddable".to_owned(),
                "skipped image img2: file nope is missing".to_owned(),
            ]
        );
    }

    #[test]
    fn rectangle_traces_a_closed_outline_and_arrow_adds_a_head() {
        let import = import_elements(json!([
            {"id": "r1", "type": "rectangle", "x": 0, "y": 0, "width": 10, "height": 10, "strokeColor": "#000000"},
            {"id": "a1", "type": "arrow", "x": 0, "y": 0, "width": 10, "height": 0, "points": [[0, 0], [10, 0]]}
        ]));
        let ink = read_ink(&import.canvas);
        assert_eq!(ids(&ink), vec!["r1", "a1", "a1-head"]);
        assert_eq!(ink[0].p, vec![0, 0, 100, 0, 100, 100, 0, 100, 0, 0]);
        assert_eq!(ink[2].p.len(), 6);
        // Lines and shapes keep strokeWidth as drawn; only freedraw is scaled.
        assert_eq!(ink[0].w, 1.0);
    }

    #[test]
    fn arrowhead_fields_choose_which_ends_get_a_head() {
        let import = import_elements(json!([
            {"id": "a1", "type": "arrow", "x": 0, "y": 0, "points": [[0, 0], [10, 0]],
             "startArrowhead": "arrow", "endArrowhead": null},
            {"id": "l1", "type": "line", "x": 0, "y": 0, "points": [[0, 0], [10, 0]],
             "endArrowhead": "triangle"},
            {"id": "l2", "type": "line", "x": 0, "y": 0, "points": [[0, 0], [10, 0]]},
            {"id": "a2", "type": "arrow", "x": 0, "y": 0, "points": [[0, 0], [10, 0]],
             "startArrowhead": "bar", "endArrowhead": "arrow"}
        ]));
        let ink = read_ink(&import.canvas);
        assert_eq!(
            ids(&ink),
            vec![
                "a1", "a1-start", "l1", "l1-head", "l2", "a2", "a2-head", "a2-start"
            ]
        );
        // The start head's tip is the first point; the end head's tip the last.
        assert_eq!(ink[1].p[2..4], [0, 0]);
        assert_eq!(ink[3].p[2..4], [100, 0]);
    }

    #[test]
    fn shapes_turn_about_their_centre() {
        let import = import_elements(json!([
            {"id": "r1", "type": "rectangle", "x": 0, "y": 0, "width": 10, "height": 10,
             "angle": FRAC_PI_2}
        ]));
        let ink = read_ink(&import.canvas);
        // A quarter turn clockwise about (5, 5) moves the top-left corner to the top-right.
        assert_eq!(ink[0].p[..4], [100, 0, 100, 100]);
    }

    #[test]
    fn lines_and_freedraw_turn_about_the_middle_of_their_points() {
        let import = import_elements(json!([
            {"id": "l1", "type": "line", "x": 0, "y": 0, "points": [[0, 0], [10, 0]], "angle": FRAC_PI_2},
            {"id": "f1", "type": "freedraw", "x": 0, "y": 0, "points": [[0, 0], [10, 0]], "angle": FRAC_PI_2}
        ]));
        let ink = read_ink(&import.canvas);
        // (0,0)-(10,0) turned a quarter about (5,0) runs from (5,-5) down to (5,5).
        assert_eq!(ink[0].p, vec![50, -50, 50, 50]);
        assert_eq!(ink[1].p, vec![50, -50, 50, 50]);
        assert!(import.warnings.is_empty());
    }

    #[test]
    fn turned_text_and_images_warn_and_arrive_upright() {
        let text = sample_drawing(
            json!([
                {"id": "t1", "type": "text", "x": 0, "y": 0, "width": 1, "height": 1, "text": "a", "angle": 0.5},
                {"id": "i1", "type": "image", "x": 0, "y": 0, "width": 1, "height": 1, "fileId": "f", "angle": 1.0},
                {"id": "t2", "type": "text", "x": 0, "y": 0, "width": 1, "height": 1, "text": "b", "angle": 0}
            ]),
            json!({"f": {"mimeType": "image/png", "dataURL": "data:image/png;base64,AA"}}),
        );
        let import = import_excalidraw(&text).unwrap();
        assert_eq!(import.canvas.nodes.len(), 3);
        assert_eq!(
            import.warnings,
            vec![
                "text t1 was rotated; imported upright".to_owned(),
                "image i1 was rotated; imported upright".to_owned(),
            ]
        );
    }

    #[test]
    fn obsidian_vault_images_become_file_nodes_on_their_path() {
        let json_text = sample_drawing(
            json!([
                {"id": "i1", "type": "image", "x": 1, "y": 2, "width": 30, "height": 40, "fileId": "abc123"},
                {"id": "i2", "type": "image", "x": 0, "y": 0, "width": 1, "height": 1, "fileId": "def456"}
            ]),
            json!({}),
        );
        let md = format!(
            "---\nexcalidraw-plugin: parsed\n---\n# Excalidraw Data\n## Text Elements\n%%\n\
             ## Embedded Files\nabc123: [[Assets/pic one.png]]\n\ndef456: ![[Other/b.png|100]]\n\n\
             ## Drawing\n```json\n{json_text}\n```\n%%\n"
        );
        let import = import_excalidraw(&md).unwrap();
        let files: Vec<Option<&str>> = import
            .canvas
            .nodes
            .iter()
            .map(|n| n.file.as_deref())
            .collect();
        assert_eq!(files, vec![Some("Assets/pic one.png"), Some("Other/b.png")]);
        assert!(import.images.is_empty());
        assert!(import.warnings.is_empty(), "{:?}", import.warnings);
    }

    #[test]
    fn markdown_with_plain_json_block_imports() {
        let json_text = sample_drawing(
            json!([{"id": "t1", "type": "text", "x": 1, "y": 2, "width": 3, "height": 4, "text": "plain"}]),
            json!({}),
        );
        let md = format!(
            "---\nexcalidraw-plugin: parsed\n---\n\n## Drawing\n```json\n{json_text}\n```\n"
        );
        let import = import_excalidraw(&md).unwrap();
        assert_eq!(import.canvas.nodes[0].text.as_deref(), Some("plain"));
    }

    #[test]
    fn markdown_with_compressed_block_imports_across_lines() {
        let json_text = sample_drawing(
            json!([{"id": "t1", "type": "text", "x": 1, "y": 2, "width": 3, "height": 4, "text": "packed"}]),
            json!({}),
        );
        let packed = pack_literals(&json_text);
        let wrapped = packed
            .as_bytes()
            .chunks(16)
            .map(|chunk| std::str::from_utf8(chunk).unwrap())
            .collect::<Vec<_>>()
            .join("\n");
        let md = format!(
            "---\nexcalidraw-plugin: parsed\n---\n## Drawing\n```compressed-json\n{wrapped}\n```\n"
        );
        let import = import_excalidraw(&md).unwrap();
        assert_eq!(import.canvas.nodes[0].text.as_deref(), Some("packed"));
    }

    #[test]
    fn export_then_import_keeps_text_strokes_and_images() {
        let mut canvas = Canvas::default();
        canvas.nodes.push(CanvasNode {
            id: "t1".into(),
            kind: "text".into(),
            text: Some("keep me".into()),
            x: 10.0,
            y: 20.0,
            width: 100.0,
            height: 30.0,
            ..CanvasNode::default()
        });
        canvas.nodes.push(CanvasNode {
            id: "img1".into(),
            kind: "file".into(),
            file: Some("pic.png".into()),
            x: 0.0,
            y: 0.0,
            width: 50.0,
            height: 50.0,
            ..CanvasNode::default()
        });
        let strokes = vec![
            pen("s1", 200.0, 300.0, 2.0, vec![0, 0, 5, -7, 12, 30]),
            FreeStroke {
                t: "highlighter".into(),
                r: vec![0, 255],
                ..pen("s2", 10.0, 10.0, 17.0, vec![0, 0, 10, 0])
            },
        ];
        write_ink(&mut canvas, &strokes);
        let images = [ExcalidrawImage {
            node_id: "img1".into(),
            mime: "image/png".into(),
            data_url: "data:image/png;base64,AA".into(),
        }];
        let exported = export_excalidraw(&canvas, &images);
        assert!(exported.warnings.is_empty(), "{:?}", exported.warnings);
        let import = import_excalidraw(&exported.json).unwrap();
        assert_eq!(import.canvas.nodes.len(), 2);
        assert_eq!(import.canvas.nodes[0].text.as_deref(), Some("keep me"));
        assert_eq!(import.images.len(), 1);
        assert_eq!(import.images[0].node_id, "img1");
        assert_eq!(read_ink(&import.canvas), strokes);
    }

    #[test]
    fn exported_freedraw_starts_at_its_first_point() {
        let mut canvas = Canvas::default();
        write_ink(
            &mut canvas,
            &[pen("s1", 200.0, 300.0, 8.5, vec![50, 20, 60, 40, 40, 10])],
        );
        let exported: Value = serde_json::from_str(&export_excalidraw(&canvas, &[]).json).unwrap();
        let s1 = element(&exported, "s1");
        assert_eq!(
            (s1["x"].as_f64(), s1["y"].as_f64()),
            (Some(205.0), Some(302.0))
        );
        assert_eq!(s1["points"], json!([[0.0, 0.0], [1.0, 2.0], [-1.0, -1.0]]));
        assert_eq!(
            (s1["width"].as_f64(), s1["height"].as_f64()),
            (Some(2.0), Some(3.0))
        );
        assert_eq!(s1["strokeWidth"].as_f64(), Some(2.0));
        assert_eq!(s1["opacity"], 100);
    }

    #[test]
    fn edges_export_as_arrows_and_what_is_dropped_is_reported() {
        let node = |id: &str, x: f64| CanvasNode {
            id: id.into(),
            kind: "text".into(),
            text: Some(id.into()),
            x,
            y: 0.0,
            width: 100.0,
            height: 50.0,
            ..CanvasNode::default()
        };
        let edge = |id: &str, to: &str| CanvasEdge {
            id: id.into(),
            from_node: "a".into(),
            from_side: Some("right".into()),
            to_node: to.into(),
            to_side: Some("left".into()),
            ..CanvasEdge::default()
        };
        let mut canvas = Canvas::default();
        canvas.nodes.extend([
            node("a", 0.0),
            node("b", 300.0),
            CanvasNode {
                id: "g".into(),
                kind: "group".into(),
                ..CanvasNode::default()
            },
        ]);
        canvas.edges.extend([
            CanvasEdge {
                from_end: Some("arrow".into()),
                to_end: Some("none".into()),
                label: Some("why".into()),
                color: Some("#ff0000".into()),
                ..edge("e1", "b")
            },
            edge("e2", "b"),
            edge("e3", "missing"),
        ]);
        let export = export_excalidraw(&canvas, &[]);
        assert_eq!(
            export.warnings,
            vec![
                "skipped group node g: nothing to show".to_owned(),
                "edge e1: label left out".to_owned(),
                "skipped edge e3: a node it joins is missing".to_owned(),
            ]
        );
        let exported: Value = serde_json::from_str(&export.json).unwrap();
        let e1 = element(&exported, "e1");
        assert_eq!(e1["type"], "arrow");
        assert_eq!(
            (e1["x"].as_f64(), e1["y"].as_f64()),
            (Some(100.0), Some(25.0))
        );
        assert_eq!(e1["points"], json!([[0.0, 0.0], [200.0, 0.0]]));
        assert_eq!(e1["startArrowhead"], "arrow");
        assert_eq!(e1["endArrowhead"], Value::Null);
        assert_eq!(e1["strokeColor"], "#ff0000");
        let e2 = element(&exported, "e2");
        assert_eq!(e2["startArrowhead"], Value::Null);
        assert_eq!(e2["endArrowhead"], "arrow");
        // Read back, an edge is a line stroke with its heads.
        let import = import_excalidraw(&export.json).unwrap();
        let ink = read_ink(&import.canvas);
        assert_eq!(ids(&ink), vec!["e1", "e1-start", "e2", "e2-head"]);
    }

    #[test]
    fn invalid_input_is_an_error_not_a_panic() {
        assert!(import_excalidraw("{").is_err());
        assert!(import_excalidraw("{\"type\":\"excalidraw\"}").is_err());
        assert!(import_excalidraw("## Drawing\n```compressed-json\n!!!\n```").is_err());
        assert!(import_excalidraw("\u{feff}").is_err());
    }

    /// A stroke as what it draws: id, tool, colour, width, pressure and absolute points.
    type Drawn = (String, String, String, f64, Vec<u8>, Vec<(f64, f64)>);

    fn drawn(canvas: &Canvas) -> Vec<Drawn> {
        read_ink(canvas)
            .into_iter()
            .map(|s| {
                let points =
                    s.p.as_chunks::<2>()
                        .0
                        .iter()
                        .map(|&[dx, dy]| (s.x + f64::from(dx) / 10.0, s.y + f64::from(dy) / 10.0))
                        .collect();
                (s.id, s.t, s.c, s.w, s.r, points)
            })
            .collect()
    }

    #[test]
    fn import_export_import_keeps_pressure_highlighter_and_arrowheads() {
        let first = import_elements(json!([
            {"id": "ink1", "type": "freedraw", "x": 100, "y": 50, "strokeColor": "#e03131",
             "strokeWidth": 2, "points": [[0, 0], [1.5, -1], [3, 2]],
             "pressures": [0.5, 1.0, 0.0], "simulatePressure": false},
            {"id": "hl", "type": "freedraw", "x": 7, "y": 8, "opacity": 40, "strokeWidth": 4,
             "points": [[0, 0], [5, 0]]},
            {"id": "a1", "type": "arrow", "x": 10, "y": 20, "points": [[0, 0], [40, 30]],
             "startArrowhead": "arrow", "endArrowhead": "arrow"},
            {"id": "t1", "type": "text", "x": 0, "y": 0, "width": 80, "height": 20,
             "text": "note"}
        ]));
        let exported = export_excalidraw(&first.canvas, &[]);
        assert!(exported.warnings.is_empty(), "{:?}", exported.warnings);
        let second = import_excalidraw(&exported.json).unwrap();
        assert_eq!(second.canvas.nodes, first.canvas.nodes);
        let (before, after) = (drawn(&first.canvas), drawn(&second.canvas));
        assert_eq!(
            ids(&read_ink(&second.canvas)),
            vec!["ink1", "hl", "a1", "a1-head", "a1-start"]
        );
        assert_eq!(before.len(), after.len());
        for (b, a) in before.iter().zip(&after) {
            assert_eq!((&b.0, &b.1, &b.2, &b.4), (&a.0, &a.1, &a.2, &a.4));
            assert!((b.3 - a.3).abs() < 1e-9, "{b:?} {a:?}");
            assert_eq!(b.5, a.5, "{}", b.0);
        }
        assert_eq!(after[0].4, vec![128, 255, 0]);
        assert_eq!(after[1].1, "highlighter");
    }

    #[test]
    fn a_drawing_that_unpacks_past_the_limit_is_refused_quickly() {
        // Each code repeats the previous text plus one unit, so a few kB unpack quadratically.
        let packed = pack_self_references(9_000);
        assert!(packed.len() < 32_000, "{}", packed.len());
        let started = std::time::Instant::now();
        match lz_decompress_base64(&packed) {
            Err(error) => assert_eq!(error, "not an Excalidraw file: corrupt compressed drawing"),
            Ok(text) => panic!("unpacked {} units", text.len()),
        }
        assert!(started.elapsed().as_secs() < 10, "{:?}", started.elapsed());
        // Below the limit the same shape still unpacks.
        assert_eq!(
            lz_decompress_base64(&pack_self_references(3)).unwrap(),
            "a".repeat(10)
        );
    }
}
