//! Canvas layout of imported OneNote pages: positions, scale, file nodes and edge cases.

use std::collections::BTreeMap;

use serde_json::Value;
use wf_core::canvas::{parse_canvas, validate};
use wf_core::onenote::{LayoutKind, OneNoteLayoutItem, import_section, page_canvas};

const FIXTURE: &[u8] = include_bytes!("fixtures/onenote/handwriting_recognition.one");
const FIXTURE_NAME: &str = "handwriting_recognition.one";

/// 0.1 mm per half inch, the unit layout offsets and sizes are stored in.
const HALF_INCH: f64 = 127.0;

fn text(
    text: &str,
    x: Option<f64>,
    y: Option<f64>,
    width: Option<f64>,
    height: Option<f64>,
) -> OneNoteLayoutItem {
    OneNoteLayoutItem {
        kind: LayoutKind::Text,
        key: String::new(),
        text: text.to_string(),
        x,
        y,
        width,
        height,
    }
}

fn file_item(
    kind: LayoutKind,
    key: &str,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> OneNoteLayoutItem {
    OneNoteLayoutItem {
        kind,
        key: key.to_string(),
        text: String::new(),
        x: Some(x),
        y: Some(y),
        width: Some(width),
        height: Some(height),
    }
}

fn files(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
    pairs
        .iter()
        .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
        .collect()
}

/// Parses the canvas, checks it is a valid JSON Canvas, and returns its nodes.
fn nodes_of(json: &str) -> Vec<Value> {
    let canvas = parse_canvas(json).expect("canvas parses");
    assert!(validate(&canvas).is_empty(), "canvas has issues: {json}");
    let value: Value = serde_json::from_str(json).expect("json");
    value["nodes"].as_array().expect("nodes").clone()
}

fn int(node: &Value, key: &str) -> i64 {
    node[key]
        .as_i64()
        .unwrap_or_else(|| panic!("{key} is not an integer in {node}"))
}

#[test]
fn offsets_scale_is_48_px_per_half_inch() {
    let layout = [text(
        "a",
        Some(HALF_INCH * 2.0),
        Some(HALF_INCH * 4.0),
        Some(HALF_INCH * 8.0),
        Some(HALF_INCH),
    )];
    let nodes = nodes_of(&page_canvas(&layout, &BTreeMap::new()));

    assert_eq!(nodes.len(), 1);
    assert_eq!(int(&nodes[0], "x"), 96);
    assert_eq!(int(&nodes[0], "y"), 192);
    assert_eq!(int(&nodes[0], "width"), 384);
    assert_eq!(int(&nodes[0], "height"), 48);
}

#[test]
fn text_nodes_keep_their_markdown_and_type() {
    let layout = [text(
        "**bold** note",
        Some(0.0),
        Some(0.0),
        Some(HALF_INCH),
        Some(HALF_INCH),
    )];
    let nodes = nodes_of(&page_canvas(&layout, &BTreeMap::new()));

    assert_eq!(nodes[0]["type"], "text");
    assert_eq!(nodes[0]["text"], "**bold** note");
}

#[test]
fn node_ids_are_unique_across_kinds() {
    let layout = [
        text("a", Some(0.0), Some(0.0), Some(HALF_INCH), Some(HALF_INCH)),
        text(
            "b",
            Some(HALF_INCH),
            Some(0.0),
            Some(HALF_INCH),
            Some(HALF_INCH),
        ),
        file_item(LayoutKind::Image, "image-1.png", 0.0, 500.0, 100.0, 100.0),
        file_item(LayoutKind::Ink, "ink-0", 0.0, 900.0, 100.0, 100.0),
    ];
    let json = page_canvas(
        &layout,
        &files(&[
            ("image-1.png", "user/p/a.png"),
            ("ink-0", "notes/Ink.note.md"),
        ]),
    );
    let nodes = nodes_of(&json);

    let mut ids: Vec<&str> = nodes.iter().map(|n| n["id"].as_str().unwrap()).collect();
    ids.sort_unstable();
    ids.dedup();
    assert_eq!(ids.len(), 4);
}

#[test]
fn image_and_ink_items_become_file_nodes_at_their_position() {
    let layout = [
        file_item(
            LayoutKind::Image,
            "image-1.png",
            HALF_INCH,
            HALF_INCH,
            HALF_INCH * 4.0,
            HALF_INCH * 3.0,
        ),
        file_item(LayoutKind::Ink, "ink-0", 0.0, 1000.0, 1000.0, 1000.0),
    ];
    let json = page_canvas(
        &layout,
        &files(&[
            ("image-1.png", "user/p/pic.png"),
            ("ink-0", "notes/Sketch.note.md"),
        ]),
    );
    let nodes = nodes_of(&json);

    let image = nodes
        .iter()
        .find(|n| n["file"] == "user/p/pic.png")
        .expect("image node");
    assert_eq!(image["type"], "file");
    assert_eq!((int(image, "x"), int(image, "y")), (48, 48));
    assert_eq!((int(image, "width"), int(image, "height")), (192, 144));

    let ink = nodes
        .iter()
        .find(|n| n["file"] == "notes/Sketch.note.md")
        .expect("ink node");
    assert_eq!(ink["type"], "file");
    assert_eq!(int(ink, "width"), 378);
}

#[test]
fn file_items_without_a_path_are_left_out() {
    let layout = [file_item(
        LayoutKind::Image,
        "image-9.png",
        0.0,
        0.0,
        100.0,
        100.0,
    )];
    let nodes = nodes_of(&page_canvas(&layout, &BTreeMap::new()));
    assert!(nodes.is_empty());
}

#[test]
fn unpositioned_items_stack_below_the_positioned_ones() {
    let layout = [
        text(
            "placed",
            Some(0.0),
            Some(0.0),
            Some(HALF_INCH * 2.0),
            Some(HALF_INCH * 2.0),
        ),
        text("loose one", None, None, None, None),
        text("loose two", None, None, None, None),
    ];
    let nodes = nodes_of(&page_canvas(&layout, &BTreeMap::new()));
    assert_eq!(nodes.len(), 3);

    let placed = &nodes[0];
    let placed_bottom = int(placed, "y") + int(placed, "height");
    for loose in &nodes[1..] {
        assert_eq!(int(loose, "x"), 0);
        assert!(
            int(loose, "y") >= placed_bottom,
            "loose node overlaps placed one"
        );
    }
    assert!(int(&nodes[2], "y") >= int(&nodes[1], "y") + int(&nodes[1], "height"));
}

#[test]
fn page_with_no_positioned_outlines_still_gives_a_valid_stack() {
    let layout = [
        text("first", None, None, None, None),
        text("second", None, None, None, None),
        text("third", None, None, None, None),
    ];
    let nodes = nodes_of(&page_canvas(&layout, &BTreeMap::new()));
    assert_eq!(nodes.len(), 3);

    let mut boxes: Vec<(i64, i64)> = nodes
        .iter()
        .map(|n| (int(n, "y"), int(n, "y") + int(n, "height")))
        .collect();
    boxes.sort_unstable();
    for pair in boxes.windows(2) {
        assert!(pair[0].1 <= pair[1].0, "stacked nodes overlap: {boxes:?}");
    }
}

#[test]
fn overlapping_outlines_keep_their_own_positions() {
    let layout = [
        text(
            "under",
            Some(0.0),
            Some(0.0),
            Some(HALF_INCH * 4.0),
            Some(HALF_INCH * 4.0),
        ),
        text(
            "over",
            Some(HALF_INCH),
            Some(HALF_INCH),
            Some(HALF_INCH * 4.0),
            Some(HALF_INCH * 4.0),
        ),
    ];
    let nodes = nodes_of(&page_canvas(&layout, &BTreeMap::new()));
    assert_eq!((int(&nodes[0], "x"), int(&nodes[0], "y")), (0, 0));
    assert_eq!((int(&nodes[1], "x"), int(&nodes[1], "y")), (48, 48));
}

#[test]
fn missing_sizes_fall_back_to_defaults() {
    let layout = [text("no size", Some(0.0), Some(0.0), None, None)];
    let nodes = nodes_of(&page_canvas(&layout, &BTreeMap::new()));
    assert!(int(&nodes[0], "width") > 0);
    assert!(int(&nodes[0], "height") > 0);
}

#[test]
fn non_finite_positions_are_treated_as_unpositioned() {
    let layout = [text(
        "nan",
        Some(f64::NAN),
        Some(f64::INFINITY),
        Some(HALF_INCH),
        Some(HALF_INCH),
    )];
    let nodes = nodes_of(&page_canvas(&layout, &BTreeMap::new()));
    assert_eq!(int(&nodes[0], "x"), 0);
}

#[test]
fn huge_offsets_stay_finite_integers() {
    let layout = [text(
        "far",
        Some(1.0e9),
        Some(-1.0e9),
        Some(HALF_INCH),
        Some(HALF_INCH),
    )];
    let nodes = nodes_of(&page_canvas(&layout, &BTreeMap::new()));
    assert!(int(&nodes[0], "x") > 0);
    assert!(int(&nodes[0], "y") < 0);
}

#[test]
fn empty_layout_is_an_empty_canvas() {
    let nodes = nodes_of(&page_canvas(&[], &BTreeMap::new()));
    assert!(nodes.is_empty());
}

#[test]
fn fixture_pages_yield_canvas_layouts() {
    let section = import_section(FIXTURE, FIXTURE_NAME).expect("fixture imports");
    for page in &section.pages {
        // Every layout item is either text or a file reference the caller supplies.
        let mut refs = BTreeMap::new();
        for item in &page.layout {
            if item.kind != LayoutKind::Text {
                let _ = refs.insert(item.key.clone(), format!("user/p/{}", item.key));
            }
        }
        let nodes = nodes_of(&page_canvas(&page.layout, &refs));
        let ids: std::collections::HashSet<&str> =
            nodes.iter().map(|n| n["id"].as_str().unwrap()).collect();
        assert_eq!(ids.len(), nodes.len(), "page {}", page.title);
    }
}

#[test]
fn fixture_page_lays_out_text_image_and_ink() {
    let section = import_section(FIXTURE, FIXTURE_NAME).expect("fixture imports");
    let page = &section.pages[0];

    let text_items: Vec<_> = page
        .layout
        .iter()
        .filter(|i| i.kind == LayoutKind::Text)
        .collect();
    assert!(
        text_items.iter().any(|i| i.x.is_some() && i.y.is_some()),
        "no positioned outline"
    );

    let images: Vec<_> = page
        .layout
        .iter()
        .filter(|i| i.kind == LayoutKind::Image)
        .collect();
    assert_eq!(images.len(), 1);
    assert!(
        page.images.iter().any(|img| img.name == images[0].key),
        "image key is not an imported image"
    );

    let ink: Vec<_> = page
        .layout
        .iter()
        .filter(|i| i.kind == LayoutKind::Ink)
        .collect();
    assert_eq!(ink.len(), 1);
    assert_eq!(ink[0].key, "ink-0");
}
