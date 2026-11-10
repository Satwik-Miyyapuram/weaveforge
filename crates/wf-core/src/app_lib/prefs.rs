//! Saved UI preferences: what a missing or unknown stored value means. Reading and writing the
//! storage stay in TS (`ink-haptics-preference`, `citation-format-preference`,
//! `wikilink-create-preference`).

/// The citation formats the editor offers, in menu order.
pub const EDITOR_CITATION_FORMATS: [&str; 5] = ["wikilink", "latex", "pandoc", "footnote", "raw"];

/// Whether ink haptics are on. Only the saved value `off` turns them off; a missing value is on.
#[must_use]
pub fn ink_haptics_on(raw: Option<&str>) -> bool {
    raw != Some("off")
}

/// The storage key for a project's citation format. `global` stands in when there is no project.
#[must_use]
pub fn citation_format_storage_key(project_id: Option<&str>) -> String {
    format!("thesis.citeFormat.{}", project_id.unwrap_or("global"))
}

/// The saved citation format when the editor offers it, else `wikilink`.
#[must_use]
pub fn parse_editor_citation_format(raw: Option<&str>) -> &'static str {
    EDITOR_CITATION_FORMATS
        .into_iter()
        .find(|format| Some(*format) == raw)
        .unwrap_or("wikilink")
}

/// `never` stops an unknown wikilink from creating a note; any other value creates one.
#[must_use]
pub fn parse_wikilink_create_mode(raw: Option<&str>) -> &'static str {
    if raw == Some("never") {
        "never"
    } else {
        "create"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ink_haptics_off_only_for_off() {
        assert!(ink_haptics_on(None));
        assert!(ink_haptics_on(Some("on")));
        assert!(ink_haptics_on(Some("")));
        assert!(!ink_haptics_on(Some("off")));
        assert!(ink_haptics_on(Some("OFF")));
    }

    #[test]
    fn citation_key_uses_project_or_global() {
        assert_eq!(
            citation_format_storage_key(Some("p1")),
            "thesis.citeFormat.p1"
        );
        assert_eq!(
            citation_format_storage_key(None),
            "thesis.citeFormat.global"
        );
        assert_eq!(citation_format_storage_key(Some("")), "thesis.citeFormat.");
    }

    #[test]
    fn citation_format_keeps_known_values_only() {
        for format in EDITOR_CITATION_FORMATS {
            assert_eq!(parse_editor_citation_format(Some(format)), format);
        }
        assert_eq!(parse_editor_citation_format(None), "wikilink");
        assert_eq!(parse_editor_citation_format(Some("bibtex")), "wikilink");
        assert_eq!(parse_editor_citation_format(Some("LaTeX")), "wikilink");
    }

    #[test]
    fn wikilink_create_mode_is_never_or_create() {
        assert_eq!(parse_wikilink_create_mode(Some("never")), "never");
        assert_eq!(parse_wikilink_create_mode(Some("create")), "create");
        assert_eq!(parse_wikilink_create_mode(None), "create");
        assert_eq!(parse_wikilink_create_mode(Some("Never")), "create");
    }
}
