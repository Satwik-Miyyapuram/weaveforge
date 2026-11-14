//! Imports a real OneNote section fixture and checks pages, ink and limits.

use wf_core::onenote::{ONENOTE_MAX_BYTES, import_section};

const FIXTURE: &[u8] = include_bytes!("fixtures/onenote/handwriting_recognition.one");
const FIXTURE_NAME: &str = "handwriting_recognition.one";

#[test]
fn imports_handwriting_fixture() {
    let section = import_section(FIXTURE, FIXTURE_NAME).expect("fixture imports");

    assert!(!section.pages.is_empty());
    assert!(section.pages.iter().all(|page| !page.title.is_empty()));
}

#[test]
fn fixture_ink_is_in_range_and_well_formed() {
    let section = import_section(FIXTURE, FIXTURE_NAME).expect("fixture imports");

    let ink_pages: Vec<_> = section
        .pages
        .iter()
        .flat_map(|page| page.ink.iter())
        .collect();
    let stroke_count: usize = ink_pages.iter().map(|page| page.strokes.len()).sum();
    assert!(stroke_count > 0);

    for page in &ink_pages {
        for stroke in &page.strokes {
            assert!(stroke.points.len() >= 2);
            assert_eq!(stroke.points.len() % 2, 0);
            assert!(
                stroke
                    .points
                    .iter()
                    .all(|coord| (0.0..=32767.0).contains(coord))
            );
        }
    }
}

#[test]
fn fixture_has_recognised_text() {
    let section = import_section(FIXTURE, FIXTURE_NAME).expect("fixture imports");

    assert!(section.pages.iter().any(|page| !page.ink_text.is_empty()));
}

#[test]
fn rejects_non_onenote_bytes() {
    assert!(import_section(b"not a onenote file", "x.one").is_err());
}

#[test]
fn rejects_oversized_input() {
    let oversized = vec![0u8; ONENOTE_MAX_BYTES + 1];
    assert!(import_section(&oversized, "x.one").is_err());
}

#[test]
fn links_render_as_markdown_and_levels_start_at_zero() {
    let section = import_section(FIXTURE, FIXTURE_NAME).expect("fixture imports");
    assert!(section.pages.iter().any(|page| page.level == 0));
    for page in &section.pages {
        assert!(!page.markdown.contains('\u{fddf}'), "hidden marker leaked");
    }
    assert!(
        section
            .pages
            .iter()
            .any(|page| page.markdown.contains("](https://example.com)"))
    );
}
