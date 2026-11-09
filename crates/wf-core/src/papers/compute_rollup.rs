//! Rollup values from related papers' field values (TS
//! `features/papers/application/compute-rollup.ts`). Pure, no I/O: the caller passes the
//! project's values.

use std::collections::HashMap;

use serde::Deserialize;

use super::paper_field::{
    PaperFieldKind, PaperFieldRollupAgg, PaperFieldValueData, parse_rollup_options,
};

/// A field definition as a rollup reads it. Only a rollup's own `options` are read.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct RollupFieldDef {
    /// Field id.
    pub id: String,
    /// Field kind: the relation to follow and the rollup itself must have the right kind.
    pub kind: PaperFieldKind,
    /// Encoded options (rollups only).
    #[serde(default)]
    pub options: Vec<String>,
}

/// One stored value of a field on a paper.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct RollupValue {
    /// Paper the value belongs to.
    pub paper_id: String,
    /// Field the value belongs to.
    pub field_id: String,
    /// The stored value.
    pub value: PaperFieldValueData,
}

/// Each listed paper's value for `rollup`, in `paper_ids` order. `None` where the rollup has
/// no value for that paper.
///
/// The `(paper, field)` index is built once for all papers, so a table fills a column with one
/// call. When a `(paper, field)` pair is stored twice, the first value wins.
#[must_use]
pub fn compute_rollup_for_papers(
    paper_ids: &[String],
    rollup: &RollupFieldDef,
    defs: &[RollupFieldDef],
    values: &[RollupValue],
) -> Vec<Option<PaperFieldValueData>> {
    let Some(plan) = RollupPlan::new(rollup, defs) else {
        return vec![None; paper_ids.len()];
    };
    let mut index: HashMap<(&str, &str), &PaperFieldValueData> =
        HashMap::with_capacity(values.len());
    for row in values {
        index
            .entry((row.paper_id.as_str(), row.field_id.as_str()))
            .or_insert(&row.value);
    }
    paper_ids
        .iter()
        .map(|paper_id| plan.compute(paper_id, &index))
        .collect()
}

/// A rollup resolved against the definitions: the relation to follow and the source field.
struct RollupPlan<'a> {
    agg: PaperFieldRollupAgg,
    relation_id: &'a str,
    /// `None` for `count`, which reads no source.
    source_id: Option<&'a str>,
}

impl<'a> RollupPlan<'a> {
    fn new(rollup: &'a RollupFieldDef, defs: &'a [RollupFieldDef]) -> Option<Self> {
        if rollup.kind != PaperFieldKind::Rollup {
            return None;
        }
        let config = parse_rollup_options(&rollup.options)?;
        let relation = defs.iter().find(|def| def.id == config.relation_field_id)?;
        if relation.kind != PaperFieldKind::Relation {
            return None;
        }
        let source_id = match config.agg {
            PaperFieldRollupAgg::Count => None,
            _ => {
                let source = config
                    .source_field_id
                    .as_deref()
                    .filter(|id| !id.is_empty())?;
                Some(defs.iter().find(|def| def.id == source)?.id.as_str())
            }
        };
        Some(Self {
            agg: config.agg,
            relation_id: relation.id.as_str(),
            source_id,
        })
    }

    fn compute(
        &self,
        paper_id: &str,
        index: &HashMap<(&str, &str), &PaperFieldValueData>,
    ) -> Option<PaperFieldValueData> {
        // A relation that is missing or not a list relates to nothing.
        let related: &[String] = match index.get(&(paper_id, self.relation_id)) {
            Some(PaperFieldValueData::List(ids)) => ids,
            _ => &[],
        };
        match self.agg {
            PaperFieldRollupAgg::Count => Some(PaperFieldValueData::Number(related.len() as f64)),
            PaperFieldRollupAgg::Values => {
                let source = self.source_id?;
                let related_values = related_values(related, source, index);
                Some(PaperFieldValueData::List(values_as_text(&related_values)))
            }
            PaperFieldRollupAgg::Sum | PaperFieldRollupAgg::Avg => {
                let source = self.source_id?;
                let related_values = related_values(related, source, index);
                let numbers: Vec<f64> =
                    related_values.iter().filter_map(|v| as_number(v)).collect();
                if numbers.is_empty() {
                    return None;
                }
                let sum = numbers.iter().sum::<f64>();
                let result = match self.agg {
                    PaperFieldRollupAgg::Avg => sum / numbers.len() as f64,
                    _ => sum,
                };
                Some(PaperFieldValueData::Number(result))
            }
        }
    }
}

/// The source values of the related papers, in relation order; papers without a value drop out.
fn related_values<'v>(
    related: &[String],
    source: &str,
    index: &HashMap<(&str, &str), &'v PaperFieldValueData>,
) -> Vec<&'v PaperFieldValueData> {
    related
        .iter()
        .filter_map(|id| index.get(&(id.as_str(), source)).copied())
        .collect()
}

/// The `values` aggregation: list items as they are, other values as their JS text.
fn values_as_text(values: &[&PaperFieldValueData]) -> Vec<String> {
    let mut out = Vec::new();
    for value in values {
        match value {
            PaperFieldValueData::List(items) => out.extend(items.iter().cloned()),
            PaperFieldValueData::Text(text) => out.push(text.clone()),
            PaperFieldValueData::Number(number) => out.push(js_number_text(*number)),
        }
    }
    out
}

/// A number, or numeric text such as " 3 " or "0x10". Blank text and lists are not numbers.
fn as_number(value: &PaperFieldValueData) -> Option<f64> {
    match value {
        PaperFieldValueData::Number(number) => number.is_finite().then_some(*number),
        PaperFieldValueData::Text(text) => js_numeric_text(text),
        PaperFieldValueData::List(_) => None,
    }
}

/// `Number(text)` in JS for text that is not blank: decimal, or hex, octal or binary with a
/// prefix. Non-finite results are not numbers here.
fn js_numeric_text(text: &str) -> Option<f64> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    for (prefix, radix) in [
        ("0x", 16),
        ("0X", 16),
        ("0o", 8),
        ("0O", 8),
        ("0b", 2),
        ("0B", 2),
    ] {
        if let Some(digits) = trimmed.strip_prefix(prefix) {
            return u64::from_str_radix(digits, radix).ok().map(|n| n as f64);
        }
    }
    trimmed.parse::<f64>().ok().filter(|n| n.is_finite())
}

/// `String(number)` in JS: shortest round-trip digits, exponent form outside 1e-6..1e21.
fn js_number_text(number: f64) -> String {
    if number == 0.0 {
        return "0".to_owned();
    }
    if !number.is_finite() {
        return if number.is_nan() {
            "NaN".to_owned()
        } else if number > 0.0 {
            "Infinity".to_owned()
        } else {
            "-Infinity".to_owned()
        };
    }
    let magnitude = number.abs();
    if (1e-6..1e21).contains(&magnitude) {
        return number.to_string();
    }
    let scientific = format!("{number:e}");
    let (mantissa, exponent) = scientific.split_once('e').unwrap_or((&scientific, "0"));
    let exponent: i32 = exponent.parse().unwrap_or(0);
    let sign = if exponent >= 0 { "+" } else { "" };
    format!("{mantissa}e{sign}{exponent}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::papers::paper_field::{PaperFieldRollupConfig, encode_rollup_options};

    fn def(id: &str, kind: PaperFieldKind, options: Vec<String>) -> RollupFieldDef {
        RollupFieldDef {
            id: id.to_owned(),
            kind,
            options,
        }
    }

    fn rollup(
        id: &str,
        relation: &str,
        agg: PaperFieldRollupAgg,
        source: Option<&str>,
    ) -> RollupFieldDef {
        def(
            id,
            PaperFieldKind::Rollup,
            encode_rollup_options(&PaperFieldRollupConfig {
                relation_field_id: relation.to_owned(),
                agg,
                source_field_id: source.map(str::to_owned),
            }),
        )
    }

    fn stored(paper: &str, field: &str, value: PaperFieldValueData) -> RollupValue {
        RollupValue {
            paper_id: paper.to_owned(),
            field_id: field.to_owned(),
            value,
        }
    }

    fn list(items: &[&str]) -> PaperFieldValueData {
        PaperFieldValueData::List(items.iter().map(|s| (*s).to_owned()).collect())
    }

    fn text(value: &str) -> PaperFieldValueData {
        PaperFieldValueData::Text(value.to_owned())
    }

    fn number(value: f64) -> PaperFieldValueData {
        PaperFieldValueData::Number(value)
    }

    /// The rollup for one paper.
    fn one(
        paper: &str,
        rollup: &RollupFieldDef,
        defs: &[RollupFieldDef],
        values: &[RollupValue],
    ) -> Option<PaperFieldValueData> {
        compute_rollup_for_papers(&[paper.to_owned()], rollup, defs, values).remove(0)
    }

    fn relation() -> RollupFieldDef {
        def("rel", PaperFieldKind::Relation, Vec::new())
    }

    fn score() -> RollupFieldDef {
        def("score", PaperFieldKind::Number, Vec::new())
    }

    fn base_values() -> Vec<RollupValue> {
        vec![
            stored("a", "rel", list(&["b", "c"])),
            stored("b", "score", number(2.0)),
            stored("c", "score", number(4.0)),
        ]
    }

    #[test]
    fn count_and_sum_over_related_papers() {
        let defs = [relation(), score()];
        let sum = rollup("sum", "rel", PaperFieldRollupAgg::Sum, Some("score"));
        let count = rollup("count", "rel", PaperFieldRollupAgg::Count, None);
        let defs = [defs[0].clone(), defs[1].clone(), sum.clone(), count.clone()];
        let values = base_values();
        assert_eq!(one("a", &count, &defs, &values), Some(number(2.0)));
        assert_eq!(one("a", &sum, &defs, &values), Some(number(6.0)));
    }

    #[test]
    fn empty_relation_gives_zero_count_and_no_sum() {
        let sum = rollup("sum", "rel", PaperFieldRollupAgg::Sum, Some("score"));
        let count = rollup("count", "rel", PaperFieldRollupAgg::Count, None);
        let defs = [relation(), score(), sum.clone(), count.clone()];
        let values = base_values();
        assert_eq!(one("b", &count, &defs, &values), Some(number(0.0)));
        assert_eq!(one("b", &sum, &defs, &values), None);
    }

    #[test]
    fn wrong_kind_or_unknown_relation_or_source_gives_none() {
        let values = base_values();
        let defs = [relation(), score()];
        let not_a_rollup = def("sum", PaperFieldKind::Number, Vec::new());
        assert_eq!(one("a", &not_a_rollup, &defs, &values), None);

        let missing_relation = rollup("sum", "nope", PaperFieldRollupAgg::Sum, Some("score"));
        assert_eq!(one("a", &missing_relation, &defs, &values), None);

        let missing_source = rollup("sum", "rel", PaperFieldRollupAgg::Sum, Some("nope"));
        assert_eq!(one("a", &missing_source, &defs, &values), None);

        let no_source = rollup("sum", "rel", PaperFieldRollupAgg::Sum, None);
        assert_eq!(one("a", &no_source, &defs, &values), None);
    }

    #[test]
    fn every_aggregation_sees_the_same_values_as_a_naive_scan() {
        let labels = def("label", PaperFieldKind::Text, Vec::new());
        let avg = rollup("avg", "rel", PaperFieldRollupAgg::Avg, Some("score"));
        let label_list = rollup("labels", "rel", PaperFieldRollupAgg::Values, Some("label"));
        let sum = rollup("sum", "rel", PaperFieldRollupAgg::Sum, Some("score"));
        let count = rollup("count", "rel", PaperFieldRollupAgg::Count, None);
        let defs = [
            relation(),
            score(),
            labels,
            avg.clone(),
            label_list.clone(),
            sum.clone(),
            count.clone(),
        ];
        let mut values = base_values();
        values.push(stored("b", "label", text("VAE")));
        values.push(stored("c", "label", text("diffusion")));
        values.push(stored("d", "rel", list(&["b", "c"])));

        assert_eq!(one("a", &count, &defs, &values), Some(number(2.0)));
        assert_eq!(one("a", &sum, &defs, &values), Some(number(6.0)));
        assert_eq!(one("a", &avg, &defs, &values), Some(number(3.0)));
        assert_eq!(
            one("a", &label_list, &defs, &values),
            Some(list(&["VAE", "diffusion"]))
        );

        // Another paper's relations resolve against the same index without leaking values.
        assert_eq!(one("d", &sum, &defs, &values), Some(number(6.0)));
        assert_eq!(one("d", &count, &defs, &values), Some(number(2.0)));
        assert_eq!(one("c", &sum, &defs, &values), None);
    }

    #[test]
    fn duplicate_pair_resolves_to_the_first_value() {
        let sum = rollup("sum", "rel", PaperFieldRollupAgg::Sum, Some("score"));
        let count = rollup("count", "rel", PaperFieldRollupAgg::Count, None);
        let defs = [relation(), score(), sum.clone(), count.clone()];
        let values = vec![
            stored("a", "rel", list(&["b"])),
            stored("b", "score", number(2.0)),
            stored("b", "score", number(99.0)),
        ];
        assert_eq!(one("a", &sum, &defs, &values), Some(number(2.0)));
        assert_eq!(one("a", &count, &defs, &values), Some(number(1.0)));
    }

    #[test]
    fn batch_matches_a_naive_scan_over_many_rows() {
        let paper_ids: Vec<String> = (0..400).map(|i| format!("p{i}")).collect();
        let relation2 = def("rel2", PaperFieldKind::Relation, Vec::new());
        let sum = rollup("sum", "rel", PaperFieldRollupAgg::Sum, Some("score"));
        let sum2 = rollup("sum2", "rel2", PaperFieldRollupAgg::Sum, Some("score"));
        let count = rollup("count", "rel", PaperFieldRollupAgg::Count, None);
        let defs = [
            relation(),
            relation2,
            score(),
            sum.clone(),
            sum2.clone(),
            count.clone(),
        ];

        let mut values = Vec::new();
        for (i, id) in paper_ids.iter().enumerate() {
            values.push(stored(id, "score", number(i as f64)));
            let targets: Vec<String> = (1..=3).map(|k| format!("p{}", (i + k) % 400)).collect();
            values.push(stored(
                id,
                "rel",
                PaperFieldValueData::List(targets.clone()),
            ));
            values.push(stored(
                id,
                "rel2",
                PaperFieldValueData::List(targets[..2].to_vec()),
            ));
        }

        let sums = compute_rollup_for_papers(&paper_ids, &sum, &defs, &values);
        let sums2 = compute_rollup_for_papers(&paper_ids, &sum2, &defs, &values);
        let counts = compute_rollup_for_papers(&paper_ids, &count, &defs, &values);
        for i in 0..400usize {
            let expected: f64 = (1..=3).map(|k| ((i + k) % 400) as f64).sum();
            let expected2: f64 = (1..=2).map(|k| ((i + k) % 400) as f64).sum();
            assert_eq!(sums[i], Some(number(expected)));
            assert_eq!(sums2[i], Some(number(expected2)));
            assert_eq!(counts[i], Some(number(3.0)));
        }
    }

    #[test]
    fn sum_and_avg_count_only_numbers_and_numeric_text_not_blanks_or_lists() {
        let related = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"];
        let mut values = vec![stored("a", "rel", list(&related))];
        values.push(stored("p1", "score", text("")));
        values.push(stored("p2", "score", list(&[])));
        values.push(stored("p3", "score", list(&["5"])));
        values.push(stored("p4", "score", text(" 3 ")));
        values.push(stored("p5", "score", text("   ")));
        values.push(stored("p6", "score", number(2.0)));
        values.push(stored("p7", "score", text("n/a")));
        let sum = rollup("sum", "rel", PaperFieldRollupAgg::Sum, Some("score"));
        let avg = rollup("avg", "rel", PaperFieldRollupAgg::Avg, Some("score"));
        let defs = [relation(), score(), sum.clone(), avg.clone()];
        assert_eq!(one("a", &sum, &defs, &values), Some(number(5.0)));
        assert_eq!(one("a", &avg, &defs, &values), Some(number(2.5)));
    }

    #[test]
    fn sum_and_avg_are_empty_when_every_related_value_is_blank() {
        let sum = rollup("sum", "rel", PaperFieldRollupAgg::Sum, Some("score"));
        let avg = rollup("avg", "rel", PaperFieldRollupAgg::Avg, Some("score"));
        let defs = [relation(), score(), sum.clone(), avg.clone()];
        let values = vec![
            stored("a", "rel", list(&["p1", "p2"])),
            stored("p1", "score", text("")),
            stored("p2", "score", list(&[])),
        ];
        assert_eq!(one("a", &sum, &defs, &values), None);
        assert_eq!(one("a", &avg, &defs, &values), None);
    }

    #[test]
    fn numeric_text_accepts_js_hex_and_refuses_non_finite() {
        let sum = rollup("sum", "rel", PaperFieldRollupAgg::Sum, Some("score"));
        let defs = [relation(), score(), sum.clone()];
        let values = vec![
            stored("a", "rel", list(&["p1", "p2", "p3"])),
            stored("p1", "score", text("0x10")),
            stored("p2", "score", text("Infinity")),
            stored("p3", "score", text("1e3")),
        ];
        assert_eq!(one("a", &sum, &defs, &values), Some(number(1016.0)));
    }

    #[test]
    fn values_list_writes_numbers_the_way_js_does() {
        let label_list = rollup("labels", "rel", PaperFieldRollupAgg::Values, Some("score"));
        let defs = [relation(), score(), label_list.clone()];
        let values = vec![
            stored(
                "a",
                "rel",
                list(&["p1", "p2", "p3", "p4", "p5", "p6", "p7"]),
            ),
            stored("p1", "score", number(3.0)),
            stored("p2", "score", number(2.5)),
            stored("p3", "score", number(1e21)),
            stored("p4", "score", number(1.5e-7)),
            stored("p5", "score", number(-0.0)),
            stored("p6", "score", list(&["x", "y"])),
            stored("p7", "score", text("z")),
        ];
        assert_eq!(
            one("a", &label_list, &defs, &values),
            Some(list(&["3", "2.5", "1e+21", "1.5e-7", "0", "x", "y", "z"]))
        );
    }
}
