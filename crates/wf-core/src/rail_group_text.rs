//! Settings rail group label and hint, ported from
//! `apps/web/src/features/settings/ui/rail-group-text.ts`. Pure: no I/O.
//!
//! A hint names only the tabs this build shows (DA-136). A fixed hint would promise a
//! Zotero tab on a Dev copy that has none.

use serde::{Deserialize, Serialize};

/// What a settings rail group says about itself, before the build is known.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct RailGroupWords {
    /// The group's label.
    pub label: String,
    /// The label to use when the tab it names is hidden: "Account" with no lab tab.
    #[serde(default)]
    pub label_without: Option<LabelWithout>,
    /// One word or phrase per tab, as `(tab, text)`, in rail order. The `integrations`
    /// tab's text is replaced by the integration titles.
    pub hints: Vec<(String, String)>,
}

/// The label to use when `tab` is hidden.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct LabelWithout {
    /// The tab whose visibility decides the label.
    pub tab: String,
    /// The label used when `tab` is hidden.
    pub label: String,
}

/// The label and hint a rail group shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct RailGroupText {
    /// Label shown on the group.
    pub label: String,
    /// Hint shown under the label, first letter capitalised.
    pub hint: String,
}

/// The label and hint for `group`, naming only the tabs in `visible`. `integration_titles`
/// fills the `integrations` hint.
#[must_use]
pub fn rail_group_text(
    group: &RailGroupWords,
    visible: &[String],
    integration_titles: &[String],
) -> RailGroupText {
    let is_visible = |tab: &str| visible.iter().any(|v| v == tab);
    let parts: Vec<String> = group
        .hints
        .iter()
        .filter(|(tab, _)| is_visible(tab))
        .map(|(tab, text)| {
            if tab == "integrations" {
                integration_titles.join(", ")
            } else {
                text.clone()
            }
        })
        .filter(|part| !part.is_empty())
        .collect();
    let hint = parts.join(", ");
    let label = match &group.label_without {
        Some(without) if !is_visible(&without.tab) => without.label.clone(),
        _ => group.label.clone(),
    };
    RailGroupText {
        label,
        hint: capitalise_first(&hint),
    }
}

/// Uppercases the first character, as `charAt(0).toUpperCase()` does for the first letter.
fn capitalise_first(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_owned()).collect()
    }

    fn account_group() -> RailGroupWords {
        RailGroupWords {
            label: "Accounts".to_owned(),
            label_without: Some(LabelWithout {
                tab: "lab".to_owned(),
                label: "Account".to_owned(),
            }),
            hints: vec![
                ("lab".to_owned(), "lab".to_owned()),
                ("integrations".to_owned(), "ignored".to_owned()),
                ("calendar".to_owned(), "calendar".to_owned()),
            ],
        }
    }

    #[test]
    fn hint_names_only_visible_tabs_and_capitalises() {
        let text = rail_group_text(
            &account_group(),
            &strings(&["lab", "calendar"]),
            &strings(&["GitHub"]),
        );
        assert_eq!(text.hint, "Lab, calendar");
        assert_eq!(text.label, "Accounts");
    }

    #[test]
    fn integrations_hint_uses_titles() {
        let text = rail_group_text(
            &account_group(),
            &strings(&["integrations"]),
            &strings(&["Cloud", "Zotero", "calendar"]),
        );
        assert_eq!(text.hint, "Cloud, Zotero, calendar");
    }

    #[test]
    fn empty_integration_titles_are_dropped() {
        let text = rail_group_text(&account_group(), &strings(&["integrations", "lab"]), &[]);
        assert_eq!(text.hint, "Lab");
    }

    #[test]
    fn label_switches_when_named_tab_is_hidden() {
        let hidden = rail_group_text(&account_group(), &strings(&[]), &[]);
        assert_eq!(hidden.label, "Account");
        assert_eq!(hidden.hint, "");
        let shown = rail_group_text(&account_group(), &strings(&["lab"]), &[]);
        assert_eq!(shown.label, "Accounts");
    }

    #[test]
    fn no_label_without_keeps_label() {
        let group = RailGroupWords {
            label: "Plain".to_owned(),
            label_without: None,
            hints: Vec::new(),
        };
        assert_eq!(rail_group_text(&group, &[], &[]).label, "Plain");
    }
}
