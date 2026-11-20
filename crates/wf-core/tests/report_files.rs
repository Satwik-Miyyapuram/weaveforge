//! Laws for report section files: `order` and `parent` frontmatter
//! (`wf_core::report::section_file`) and the field edit they use
//! (`wf_core::sync::entity_file::set_field`).

use proptest::prelude::*;
use serde_json::{Map, Value};
use wf_core::report::section_file::{
    parent_cycles, section_order, section_parent, set_section_order,
};
use wf_core::sync::entity_file::{EntityFile, parse_entity_file, render_entity_file};

fn section(order: Option<f64>, extra: &[(&str, &str)], body: &str) -> String {
    let mut fields = Map::new();
    let _ = fields.insert("title".to_owned(), Value::from("Methods"));
    if let Some(order) = order {
        let _ = fields.insert("order".to_owned(), Value::from(order));
    }
    for (key, value) in extra {
        let _ = fields.insert((*key).to_owned(), Value::from(*value));
    }
    render_entity_file(&EntityFile {
        id: "sec-1".to_owned(),
        entity_type: "report_section".to_owned(),
        wf: Some(3),
        fields,
        body: body.to_owned(),
    })
}

fn changed_lines(a: &str, b: &str) -> Vec<(String, String)> {
    a.split('\n')
        .zip(b.split('\n'))
        .filter(|(x, y)| x != y)
        .map(|(x, y)| (x.to_owned(), y.to_owned()))
        .collect()
}

proptest! {
    /// Law: a reorder changes only the `order` line.
    #[test]
    fn section_reorder_changes_order_only(
        from in -1000i32..1000,
        to in -1000i32..1000,
        body in "[ -~\n]{0,120}",
        tag in "[a-z]{1,8}",
    ) {
        let text = section(Some(f64::from(from)), &[("status", "draft"), ("tag", &tag)], &body);
        let moved = set_section_order(&text, f64::from(to));
        prop_assert!(moved.is_some());
        let moved = moved.unwrap_or_default();
        prop_assert_eq!(text.split('\n').count(), moved.split('\n').count());
        let diff = changed_lines(&text, &moved);
        prop_assert!(diff.len() <= 1);
        if from != to {
            prop_assert_eq!(diff, vec![(format!("order: {from}"), format!("order: {to}"))]);
        }
        let parsed = parse_entity_file(&moved);
        prop_assert_eq!(parsed.as_ref().and_then(section_order), Some(f64::from(to)));
        prop_assert_eq!(parsed.map(|f| f.body), Some(body));
    }

    /// Law: a cycle is reported exactly when following parents returns to the start.
    #[test]
    fn parent_cycle_iff_loop(parents in prop::collection::vec(prop::option::of(0usize..8), 1..8)) {
        let links: Vec<(String, Option<String>)> = parents
            .iter()
            .enumerate()
            .map(|(i, p)| (format!("s{i}"), p.filter(|&p| p < parents.len()).map(|p| format!("s{p}"))))
            .collect();
        let cycles = parent_cycles(&links);
        for (i, _) in parents.iter().enumerate() {
            // Brute force: walk at most n steps and see if we come back.
            let mut at = Some(i);
            let mut back = false;
            for _ in 0..parents.len() {
                at = at.and_then(|k| parents.get(k).copied().flatten()).filter(|&k| k < parents.len());
                if at == Some(i) {
                    back = true;
                    break;
                }
            }
            prop_assert_eq!(cycles.contains(&format!("s{i}")), back);
        }
    }
}

#[test]
fn reorder_adds_missing_order_line_before_the_fence() {
    let text = section(None, &[], "Body\n");
    let moved = set_section_order(&text, 2.5).unwrap_or_default();
    assert!(moved.contains("\norder: 2.5\n---\nBody\n"), "{moved}");
}

#[test]
fn reorder_of_plain_markdown_is_refused() {
    assert_eq!(set_section_order("# no frontmatter\n", 1.0), None);
}

#[test]
fn parent_cycle_is_badged_and_parent_read_from_file() {
    let a = section(Some(1.0), &[("parent", "b")], "");
    let parsed = parse_entity_file(&a);
    assert_eq!(
        parsed.as_ref().and_then(section_parent),
        Some("b".to_owned())
    );
    let links = vec![
        ("a".to_owned(), Some("b".to_owned())),
        ("b".to_owned(), Some("a".to_owned())),
        ("c".to_owned(), Some("a".to_owned())),
        ("d".to_owned(), Some("d".to_owned())),
    ];
    let cycles: Vec<String> = parent_cycles(&links).into_iter().collect();
    assert_eq!(cycles, ["a", "b", "d"]);
}
