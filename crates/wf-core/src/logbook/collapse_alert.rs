//! Short form of a citation-alert log entry (DA-110).

use serde::{Deserialize, Serialize};

use crate::reader_analysis::lines::js_trim;

/// How many citing papers a citation alert shows before "Show n more".
const ALERT_TOP: usize = 5;

/// The short form of a citation alert: its text up to the fifth listed paper, and how many
/// listed papers that leaves out.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[allow(missing_docs)]
pub struct CollapsedAlert {
    pub shown: String,
    #[cfg_attr(feature = "specta", specta(type = u32))]
    pub hidden: usize,
}

/// `collapseAlert`: the short form of a citation-alert entry, or `None` for any other entry or
/// an alert short enough to show whole.
///
/// The "…and n more" line the alert writes after its list stays with the hidden rows, so the
/// expanded entry reads exactly as it was stored.
#[must_use]
pub fn collapse_alert(headline: &str, rest: &str) -> Option<CollapsedAlert> {
    if !headline.starts_with("Citation alert:") {
        return None;
    }
    let lines: Vec<&str> = rest.split('\n').collect();
    let is_item = |line: &str| line.starts_with("- ");
    let is_paper = |line: &str| is_item(line) && !line.starts_with("- …and ");
    let papers = lines.iter().filter(|line| is_paper(line)).count();
    if papers <= ALERT_TOP {
        return None;
    }

    let mut seen = 0;
    let mut kept: Vec<&str> = Vec::new();
    for line in &lines {
        if !is_item(line) {
            kept.push(line);
        } else if is_paper(line) {
            seen += 1;
            if seen <= ALERT_TOP {
                kept.push(line);
            }
        }
    }
    Some(CollapsedAlert {
        shown: js_trim(&kept.join("\n")).to_owned(),
        hidden: papers - ALERT_TOP,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paper(n: usize) -> String {
        format!("- Paper {n}")
    }

    #[test]
    fn ignores_other_entries() {
        assert_eq!(collapse_alert("Plain note", &paper(1)), None);
    }

    #[test]
    fn short_alert_is_not_collapsed() {
        let rest = (1..=5).map(paper).collect::<Vec<_>>().join("\n");
        assert_eq!(collapse_alert("Citation alert: x", &rest), None);
    }

    #[test]
    fn keeps_five_papers_and_counts_hidden() {
        let mut lines: Vec<String> = vec!["Intro line".into()];
        lines.extend((1..=7).map(paper));
        lines.push("- …and 2 more".into());
        let rest = lines.join("\n");
        let got = collapse_alert("Citation alert: x", &rest).expect("collapsed");
        assert_eq!(got.hidden, 2);
        assert!(got.shown.starts_with("Intro line"));
        assert!(got.shown.contains("Paper 5"));
        assert!(!got.shown.contains("Paper 6"));
        assert!(!got.shown.contains("…and 2 more"));
    }
}
