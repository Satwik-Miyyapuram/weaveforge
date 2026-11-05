//! The PRISMA flow diagram as a `LaTeX` figure a report can `\input`. Port of
//! `packages/core/src/features/report/domain/prisma-figure.ts`: `TikZ` rather than
//! an image, so the figure recompiles at the report's own font and column width.

use crate::reader_analysis::lines::js_trim;
use crate::report::markdown_to_latex::escape_latex_text;

/// The packages the figure needs, for a preamble that does not have them yet.
pub const PRISMA_FIGURE_PACKAGES: &[&str] = &["tikz", "float"];

const BOX: &str = "\\tikzstyle{prismabox}=[draw, rectangle, text width=6.2cm, minimum height=1cm, align=left, inner sep=6pt]";
const ARROW: &str = "\\tikzstyle{prismaflow}=[->, >=latex, thick]";

/// PRISMA box counts, derived from the screening decisions every time they are asked for.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PrismaCounts {
    /// Everything the searches turned up, before anything was thrown away.
    pub identified: f64,
    /// Records removed as duplicates of another record.
    pub duplicates: f64,
    /// What was left to screen on title and abstract.
    pub screened: f64,
    /// Records excluded on title and abstract.
    pub excluded_at_screening: f64,
    /// Full texts sought and assessed.
    pub eligible: f64,
    /// Full texts excluded at full-text screening.
    pub excluded_at_full_text: f64,
    /// Studies included.
    pub included: f64,
    /// Items nobody has decided yet. A warning, not a box.
    pub undecided: f64,
    /// Items where reviewers disagree. A warning, not a box.
    pub conflicts: f64,
}

/// One exclusion reason and how many full texts it accounts for.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct ExclusionReasonCount {
    /// The reason, as a reviewer typed it.
    pub reason: String,
    /// Full texts excluded for this reason.
    pub count: f64,
}

/// Optional inputs to the figure. `Default` gives the TS defaults.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct PrismaFigureOptions {
    /// `\label{...}`, so the prose can `\ref` it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// Caption text, escaped on output.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caption: Option<String>,
    /// Exclusion reasons, as `exclusionReasons` returns them.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasons: Option<Vec<ExclusionReasonCount>>,
    /// The database or register the records came from, if it is worth naming.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

/// `n` as a JS template literal prints it: no `.0`, and `-0` prints as `0`.
fn js_number(n: f64) -> String {
    if n.is_nan() {
        return String::from("NaN");
    }
    if n.is_infinite() {
        return String::from(if n > 0.0 { "Infinity" } else { "-Infinity" });
    }
    // Adding zero turns -0.0 into 0.0, which JS prints without a sign.
    let n = n + 0.0;
    format!("{n}")
}

/// One count line: the escaped label, then `(n = count)`.
fn line(count: f64, label: &str) -> String {
    let text = escape_latex_text(label);
    let n = js_number(count);
    format!("{text} (n = {n})")
}

/// One box's text: a heading, then the counts under it.
///
/// `\\` inside a `text width` node is a line break, and each line is escaped
/// before it goes in, because a reviewer-typed reason is prose.
fn prisma_box(name: &str, heading: &str, lines: &[String], at: &str) -> String {
    let heading = escape_latex_text(heading);
    let mut parts = vec![format!("\\textbf{{{heading}}}")];
    parts.extend(lines.iter().cloned());
    let body = parts.join(" \\\\ ");
    format!("  \\node[prismabox] ({name}) {at} {{{body}}};")
}

/// The boxes of the flow, in the order the TS emits them.
fn flow_nodes(counts: &PrismaCounts, options: &PrismaFigureOptions) -> Vec<String> {
    let first = match options.source.as_deref().filter(|s| !s.is_empty()) {
        Some(source) => format!("Records from {source}"),
        None => String::from("Records identified"),
    };
    let mut identified = vec![line(counts.identified, &first)];
    if counts.duplicates.abs() > 0.0 {
        identified.push(line(counts.duplicates, "Duplicates removed"));
    }

    let reasons = options.reasons.as_deref().unwrap_or(&[]);
    let named: Vec<String> = reasons
        .iter()
        .filter(|entry| !js_trim(&entry.reason).is_empty())
        .map(|entry| line(entry.count, &entry.reason))
        .collect();
    let excluded = if named.is_empty() {
        vec![line(counts.excluded_at_full_text, "Full texts excluded")]
    } else {
        named
    };

    vec![
        prisma_box("identified", "Identification", &identified, ""),
        prisma_box(
            "screened",
            "Screening",
            &[line(counts.screened, "Records screened")],
            "[below=of identified]",
        ),
        prisma_box(
            "screenexcluded",
            "Excluded on title and abstract",
            &[line(counts.excluded_at_screening, "Records excluded")],
            "[right=1.2cm of screened]",
        ),
        prisma_box(
            "eligible",
            "Eligibility",
            &[line(counts.eligible, "Full texts assessed")],
            "[below=of screened]",
        ),
        prisma_box(
            "fullexcluded",
            "Excluded at full text",
            &excluded,
            "[right=1.2cm of eligible]",
        ),
        prisma_box(
            "included",
            "Included",
            &[line(counts.included, "Studies included")],
            "[below=of eligible]",
        ),
    ]
}

/// The figure as a string to write beside the report's other sources.
///
/// Returned rather than written: the caller decides whether it becomes a file,
/// a block in the editor, or something to show and discard.
#[must_use]
pub fn prisma_figure_tex(counts: &PrismaCounts, options: &PrismaFigureOptions) -> String {
    let caption = escape_latex_text(
        options
            .caption
            .as_deref()
            .unwrap_or("Study selection (PRISMA 2020)."),
    );
    let label = options.label.as_deref().unwrap_or("fig:prisma");

    let mut lines: Vec<String> = vec![
        "% Generated by WeaveForge from the screening decisions. Regenerate rather".into(),
        "% than editing: the numbers are derived, and an edit here would be a claim".into(),
        "% the data does not make.".into(),
        "\\begin{figure}[H]".into(),
        "  \\centering".into(),
        format!("  {BOX}"),
        format!("  {ARROW}"),
        "  \\begin{tikzpicture}[node distance=1.4cm]".into(),
    ];
    lines.extend(flow_nodes(counts, options));

    let draws: [&str; 5] = [
        "    \\draw[prismaflow] (identified) -- (screened);",
        "    \\draw[prismaflow] (screened) -- (screenexcluded);",
        "    \\draw[prismaflow] (screened) -- (eligible);",
        "    \\draw[prismaflow] (eligible) -- (fullexcluded);",
        "    \\draw[prismaflow] (eligible) -- (included);",
    ];
    lines.extend(draws.map(String::from));

    let tail: Vec<String> = vec![
        "  \\end{tikzpicture}".into(),
        format!("  \\caption{{{caption}}}"),
        format!("  \\label{{{label}}}"),
        "\\end{figure}".into(),
        String::new(),
    ];
    lines.extend(tail);
    lines.join("\n")
}

/// What is not yet settled, in a sentence, or `None` when everything is.
///
/// Shown next to the figure rather than folded into it: a diagram whose boxes
/// quietly omit undecided papers reads as finished when it is not.
#[must_use]
pub fn prisma_caveat(counts: &PrismaCounts) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    if counts.undecided.abs() > 0.0 {
        let n = js_number(counts.undecided);
        parts.push(format!("{n} not yet screened"));
    }
    if counts.conflicts.abs() > 0.0 {
        let n = js_number(counts.conflicts);
        parts.push(format!("{n} where reviewers disagree"));
    }
    if parts.is_empty() {
        return None;
    }
    let joined = parts.join(", ");
    Some(format!(
        "{joined}. The diagram counts only settled decisions."
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn counts() -> PrismaCounts {
        PrismaCounts {
            identified: 3.0,
            duplicates: 1.0,
            screened: 2.0,
            excluded_at_screening: 1.0,
            eligible: 1.0,
            excluded_at_full_text: 0.0,
            included: 1.0,
            undecided: 0.0,
            conflicts: 0.0,
        }
    }

    #[test]
    fn counts_reach_the_boxes() {
        let tex = prisma_figure_tex(&counts(), &PrismaFigureOptions::default());
        for expected in [
            "Records identified (n = 3)",
            "Duplicates removed (n = 1)",
            "Records screened (n = 2)",
            "Studies included (n = 1)",
            "\\begin{figure}",
            "\\end{figure}",
        ] {
            assert!(tex.contains(expected), "missing {expected}");
        }
    }

    #[test]
    fn reason_typed_by_a_reviewer_cannot_end_the_document() {
        let options = PrismaFigureOptions {
            reasons: Some(vec![ExclusionReasonCount {
                reason: "50% dropout & \\end{figure} #1".into(),
                count: 2.0,
            }]),
            ..Default::default()
        };
        let tex = prisma_figure_tex(&counts(), &options);
        assert_eq!(tex.matches("\\end{figure}").count(), 1);
        assert!(tex.contains("50\\% dropout \\& \\textbackslash{}end"));
    }

    #[test]
    fn caption_and_label_default_and_override() {
        let defaults = prisma_figure_tex(&counts(), &PrismaFigureOptions::default());
        assert!(defaults.contains("\\caption{Study selection (PRISMA 2020).}"));
        assert!(defaults.contains("\\label{fig:prisma}"));

        let options = PrismaFigureOptions {
            caption: Some("How we chose.".into()),
            label: Some("fig:selection".into()),
            ..Default::default()
        };
        let tex = prisma_figure_tex(&counts(), &options);
        assert!(tex.contains("\\caption{How we chose.}"));
        assert!(tex.contains("\\label{fig:selection}"));
    }

    #[test]
    fn unsettled_is_said_beside_the_figure_never_inside() {
        assert_eq!(prisma_caveat(&counts()), None);
        let open = PrismaCounts {
            undecided: 4.0,
            conflicts: 1.0,
            ..counts()
        };
        assert_eq!(
            prisma_caveat(&open).as_deref(),
            Some(
                "4 not yet screened, 1 where reviewers disagree. The diagram counts only settled decisions."
            )
        );
        let tex = prisma_figure_tex(&open, &PrismaFigureOptions::default());
        assert!(!tex.contains("not yet screened"));
    }

    #[test]
    fn source_names_the_first_box_when_given() {
        let options = PrismaFigureOptions {
            source: Some("PubMed".into()),
            ..Default::default()
        };
        let tex = prisma_figure_tex(&counts(), &options);
        assert!(tex.contains("Records from PubMed (n = 3)"));
        let blank = PrismaFigureOptions {
            source: Some(String::new()),
            ..Default::default()
        };
        assert!(prisma_figure_tex(&counts(), &blank).contains("Records identified (n = 3)"));
    }

    #[test]
    fn numbers_print_as_js_interpolation_does() {
        assert_eq!(js_number(12.0), "12");
        assert_eq!(js_number(0.5), "0.5");
        assert_eq!(js_number(-0.0), "0");
        assert_eq!(js_number(f64::NAN), "NaN");
    }
}
