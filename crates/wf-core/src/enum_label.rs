//! Human labels for enum values, ported from `apps/web/src/lib/enum-label.ts`.
//! One label per value, sentence case, in a fixed order. A value with no entry
//! is humanised, so a new enum value still reads well. Pure: no I/O.

use serde::Serialize;

/// One enum value with its label, in the fixed display order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct EnumOption {
    /// The stored enum value, for example `in_progress`.
    pub value: &'static str,
    /// The label shown to people, for example `In progress`.
    pub label: &'static str,
}

/// Labels for each known enum kind, keyed by the camelCase kind name the web app uses.
const LABELS: &[(&str, &[EnumOption])] = &[
    (
        "paperStatus",
        &[
            EnumOption {
                value: "to_read",
                label: "To read",
            },
            EnumOption {
                value: "reading",
                label: "Reading",
            },
            EnumOption {
                value: "read",
                label: "Done",
            },
            EnumOption {
                value: "skimmed",
                label: "Skimmed",
            },
        ],
    ),
    (
        "milestoneStatus",
        &[
            EnumOption {
                value: "planned",
                label: "Planned",
            },
            EnumOption {
                value: "in_progress",
                label: "In progress",
            },
            EnumOption {
                value: "done",
                label: "Done",
            },
            EnumOption {
                value: "blocked",
                label: "Blocked",
            },
        ],
    ),
    (
        "experimentStatus",
        &[
            EnumOption {
                value: "planned",
                label: "Planned",
            },
            EnumOption {
                value: "running",
                label: "Running",
            },
            EnumOption {
                value: "done",
                label: "Done",
            },
            EnumOption {
                value: "failed",
                label: "Failed",
            },
            EnumOption {
                value: "abandoned",
                label: "Abandoned",
            },
        ],
    ),
    (
        "relation",
        &[
            EnumOption {
                value: "cites",
                label: "Cites",
            },
            EnumOption {
                value: "extends",
                label: "Extends",
            },
            EnumOption {
                value: "contradicts",
                label: "Contradicts",
            },
            EnumOption {
                value: "similar",
                label: "Similar",
            },
            EnumOption {
                value: "builds_on",
                label: "Builds on",
            },
            EnumOption {
                value: "uses_method",
                label: "Uses method",
            },
        ],
    ),
    (
        "dependency",
        &[
            EnumOption {
                value: "milestone",
                label: "Another milestone",
            },
            EnumOption {
                value: "experiment",
                label: "An experiment",
            },
            EnumOption {
                value: "paper",
                label: "A paper",
            },
            EnumOption {
                value: "external",
                label: "Something outside WeaveForge",
            },
        ],
    ),
    (
        "shareAccess",
        &[
            EnumOption {
                value: "view",
                label: "Can view",
            },
            EnumOption {
                value: "comment",
                label: "Can comment",
            },
            EnumOption {
                value: "edit",
                label: "Can edit",
            },
        ],
    ),
];

fn options_for(kind: &str) -> Option<&'static [EnumOption]> {
    LABELS
        .iter()
        .find(|(name, _)| *name == kind)
        .map(|(_, options)| *options)
}

/// `made_up_kind` reads `Made up kind`.
#[must_use]
pub fn humanise(value: &str) -> String {
    let words = value.replace('_', " ");
    let words = words.trim();
    let mut chars = words.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + &chars.as_str().to_lowercase(),
        None => String::new(),
    }
}

/// The label for `value` under `kind`, humanised when the value has no entry.
/// An unknown kind has no entries, so every value is humanised.
#[must_use]
pub fn enum_label(kind: &str, value: &str) -> String {
    options_for(kind)
        .and_then(|options| options.iter().find(|option| option.value == value))
        .map_or_else(|| humanise(value), |option| option.label.to_string())
}

/// Every value of `kind` with its label, in the fixed order. Empty for an unknown kind.
#[must_use]
pub fn enum_options(kind: &str) -> &'static [EnumOption] {
    options_for(kind).unwrap_or(&[])
}

/// The phrase for a relation seen from the paper it reaches: `cites` reads `Cited by`.
/// A value with no entry is humanised, as [`enum_label`] does.
#[must_use]
pub fn incoming_relation_label(relation: &str) -> String {
    match relation {
        "cites" => "Cited by".to_string(),
        "extends" => "Extended by".to_string(),
        "contradicts" => "Contradicted by".to_string(),
        "similar" => "Similar".to_string(),
        "builds_on" => "Built on by".to_string(),
        "uses_method" => "Method used by".to_string(),
        other => humanise(other),
    }
}

#[cfg(test)]
mod tests {
    use super::{enum_label, enum_options, humanise, incoming_relation_label};

    #[test]
    fn incoming_relation_labels_read_from_the_other_paper() {
        assert_eq!(incoming_relation_label("cites"), "Cited by");
        assert_eq!(incoming_relation_label("uses_method"), "Method used by");
        assert_eq!(incoming_relation_label("made_up"), "Made up");
    }

    #[test]
    fn known_values_use_their_label() {
        assert_eq!(enum_label("paperStatus", "read"), "Done");
        assert_eq!(enum_label("milestoneStatus", "in_progress"), "In progress");
        assert_eq!(
            enum_label("dependency", "external"),
            "Something outside WeaveForge"
        );
    }

    #[test]
    fn unknown_values_are_humanised() {
        assert_eq!(enum_label("experimentStatus", "on_hold"), "On hold");
        assert_eq!(enum_label("unknownKind", "made_up_kind"), "Made up kind");
    }

    #[test]
    fn humanise_trims_and_sentence_cases() {
        assert_eq!(humanise("  ALL_CAPS  "), "All caps");
        assert_eq!(humanise(""), "");
    }

    #[test]
    fn options_keep_the_fixed_order() {
        let values: Vec<&str> = enum_options("relation").iter().map(|o| o.value).collect();
        assert_eq!(
            values,
            [
                "cites",
                "extends",
                "contradicts",
                "similar",
                "builds_on",
                "uses_method"
            ]
        );
        assert!(enum_options("unknownKind").is_empty());
    }
}
