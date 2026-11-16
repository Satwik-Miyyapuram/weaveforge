//! JSON Canvas against files laid out as Obsidian writes them: a canvas read and written back
//! is byte for byte the same, plugin fields included, and the samples break no rule.

use wf_core::canvas::{canvas_bounds, canvas_text, group_members, parse_canvas, validate};

const SAMPLE: &str = include_str!("fixtures/canvas/obsidian-sample.canvas");
const ADVANCED: &str = include_str!("fixtures/canvas/advanced-canvas.canvas");

#[test]
fn obsidian_sample_round_trips_byte_for_byte() {
    let canvas = parse_canvas(SAMPLE).unwrap();
    assert_eq!(canvas.nodes.len(), 6);
    assert_eq!(canvas.edges.len(), 3);
    assert_eq!(canvas_text(&canvas), SAMPLE);
}

#[test]
fn plugin_fields_round_trip_byte_for_byte() {
    // Advanced Canvas (a popular Obsidian plugin) adds node, edge and top-level fields.
    let canvas = parse_canvas(ADVANCED).unwrap();
    assert!(canvas.nodes[0].extra.contains_key("styleAttributes"));
    assert!(canvas.extra.contains_key("metadata"));
    assert_eq!(canvas_text(&canvas), ADVANCED);
}

#[test]
fn a_plugin_field_between_known_fields_keeps_its_value_and_moves_to_the_end() {
    // Unknown fields are written after the known ones, so a file that interleaves them changes
    // once (key order only) on its first save, then stays stable.
    let interleaved = ADVANCED.replace(
        r#""text":"Portal","x":300,"y":0,"width":250,"height":60,"portalToFile":"Other.canvas"}"#,
        r#""text":"Portal","portalToFile":"Other.canvas","x":300,"y":0,"width":250,"height":60}"#,
    );
    assert_ne!(interleaved, ADVANCED);
    assert_eq!(canvas_text(&parse_canvas(&interleaved).unwrap()), ADVANCED);
}

#[test]
fn samples_break_no_rule() {
    for text in [SAMPLE, ADVANCED] {
        assert_eq!(validate(&parse_canvas(text).unwrap()), vec![]);
    }
}

#[test]
fn sample_geometry() {
    let canvas = parse_canvas(SAMPLE).unwrap();
    let bounds = canvas_bounds(&canvas).unwrap();
    assert_eq!(
        (bounds.x, bounds.y, bounds.width, bounds.height),
        (-620.0, -360.0, 1440.0, 720.0)
    );
    assert_eq!(
        group_members(&canvas, "5d0a3f1c9e7b2a64"),
        vec!["b1f0c2d3e4a59687", "0c9e8d7f6a5b4c3d", "7a6b5c4d3e2f1a0b"]
    );
}

#[test]
fn a_crlf_copy_still_reads_and_is_written_back_with_lf() {
    let crlf = SAMPLE.replace('\n', "\r\n");
    let canvas = parse_canvas(&crlf).unwrap();
    assert_eq!(canvas_text(&canvas), SAMPLE);
}
