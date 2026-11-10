//! Pure labels and hunk grouping for the sync issues panel, plus the device-named
//! adoption label that avoids a clash. Ports the helpers in
//! `apps/web/src/features/offline-sync/ui/sync-issues-panel.tsx` (`groupHunks`,
//! `isSettled`, `deviceMarkers`, `kindOf`, `nameOf`, `humanize`, `plural`) and
//! `apps/web/src/features/offline-sync/domain/adoption.ts` (`uniqueName`).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::text_diff::{
    DiffLine, DiffOp, MARKER_OURS, MARKER_THEIRS, diff_body, has_conflict_markers,
    write_conflict_markers,
};
use crate::reader_analysis::lines::js_trim;

/// Longest conflict name shown before it is cut with an ellipsis (JS UTF-16 units).
const NAME_LIMIT: usize = 70;

/// A run of lines in the panel: a changed run carries its hunk index, an unchanged run has none.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct HunkGroup {
    /// Hunk index of a changed run; `None` for a run of unchanged lines.
    pub hunk: Option<u32>,
    /// The lines of this run, in order.
    pub lines: Vec<DiffLine>,
}

/// The choice a user made for one conflicting field.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Choice {
    /// Keep this device's copy.
    Local,
    /// Take the cloud copy.
    Remote,
    /// Pick a side per hunk; keys are hunk indexes, values the picked side.
    Hunks {
        /// Picked side per hunk index.
        picks: BTreeMap<String, String>,
    },
    /// A hand-edited text, possibly still holding conflict markers.
    Edit {
        /// The edited text.
        text: String,
    },
}

/// Runs of unchanged lines, and each changed run tagged with its hunk index, as `diffBody` numbers them.
#[must_use]
pub fn group_hunks(lines: &[DiffLine]) -> Vec<HunkGroup> {
    let mut groups: Vec<HunkGroup> = Vec::new();
    let mut next: u32 = 0;
    for line in lines {
        let changed = line.op != DiffOp::Same;
        if let Some(last) = groups.last_mut()
            && last.hunk.is_some() == changed
        {
            last.lines.push(line.clone());
            continue;
        }
        let hunk = changed.then(|| {
            let index = next;
            next += 1;
            index
        });
        groups.push(HunkGroup {
            hunk,
            lines: vec![line.clone()],
        });
    }
    groups
}

/// Whether a field's choice is complete: an edit with no markers left, a hunk pick for every hunk,
/// or a plain side. No choice is never settled.
#[must_use]
pub fn is_settled(choice: Option<&Choice>, ours: &str, theirs: &str) -> bool {
    match choice {
        None => false,
        Some(Choice::Edit { text }) => !has_conflict_markers(text),
        Some(Choice::Hunks { picks }) => diff_body(ours, theirs)
            .hunks
            .iter()
            .all(|hunk| picks.contains_key(&hunk.index.to_string())),
        Some(_) => true,
    }
}

/// Markers named for the two sides of a sync, not the folder import they were written for.
#[must_use]
pub fn device_markers(ours: &str, theirs: &str) -> String {
    write_conflict_markers(ours, theirs)
        .split('\n')
        .map(|line| {
            if line == MARKER_OURS {
                "<<<<<<< this device"
            } else if line == MARKER_THEIRS {
                ">>>>>>> cloud"
            } else {
                line
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Human kind for a synced table: `vault_pages` is a note, otherwise the singular words.
#[must_use]
pub fn kind_of(table: &str) -> String {
    if table == "vault_pages" {
        return "Note".to_owned();
    }
    let spaced = table.replace('_', " ");
    capitalize(spaced.strip_suffix('s').unwrap_or(&spaced))
}

/// The row's own title, name or label rather than a uuid. Cut to 70 characters with an ellipsis.
#[must_use]
pub fn name_of(local: &Map<String, Value>, remote: Option<&Map<String, Value>>) -> String {
    let empty = Map::new();
    let remote = remote.unwrap_or(&empty);
    let name = [local, remote]
        .into_iter()
        .flat_map(|row| {
            ["title", "name", "label"]
                .into_iter()
                .map(move |key| row.get(key))
        })
        .find_map(|value| match value {
            Some(Value::String(text)) if !js_trim(text).is_empty() => Some(text.as_str()),
            _ => None,
        });
    match name {
        None => "Untitled".to_owned(),
        Some(text) => truncate_units(text, NAME_LIMIT),
    }
}

/// A field name as a label: `_id` dropped, underscores to spaces, first letter capitalised.
#[must_use]
pub fn humanize(field: &str) -> String {
    let base = field.strip_suffix("_id").unwrap_or(field);
    capitalize(&base.replace('_', " "))
}

/// "1 conflict" or "3 conflicts"; `many` is the plural word when it is not `word` plus "s".
#[must_use]
pub fn plural(n: u32, word: &str, many: Option<&str>) -> String {
    let noun = if n == 1 {
        word.to_owned()
    } else {
        many.map_or_else(|| format!("{word}s"), str::to_owned)
    };
    format!("{n} {noun}")
}

/// `Thesis` becomes `Thesis (desktop)`. If that is taken too, count up from there rather than overwrite.
#[must_use]
pub fn unique_device_name(name: &str, device_label: &str, taken: &[String]) -> String {
    let base = format!("{name} ({device_label})");
    if !taken.contains(&base) {
        return base;
    }
    let mut n: u32 = 2;
    loop {
        let candidate = format!("{name} ({device_label} {n})");
        if !taken.contains(&candidate) {
            return candidate;
        }
        n += 1;
    }
}

/// The name a device gets in an adoption suffix, from its `navigator.platform`
/// string: "Mac", "Windows" or "Linux", matched case-insensitively, else "this device".
/// Ports `deviceLabel` in `apps/web/src/features/offline-sync/ui/enable-sync.ts`.
#[must_use]
pub fn device_label(platform: &str) -> String {
    let platform = platform.to_ascii_lowercase();
    let label = if platform.contains("mac") {
        "Mac"
    } else if platform.contains("win") {
        "Windows"
    } else if platform.contains("linux") {
        "Linux"
    } else {
        "this device"
    };
    label.to_owned()
}

fn capitalize(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

fn truncate_units(text: &str, limit: usize) -> String {
    let units: Vec<u16> = text.encode_utf16().collect();
    if units.len() > limit {
        format!("{}\u{2026}", String::from_utf16_lossy(&units[..limit]))
    } else {
        text.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn device_label_names_the_platform_or_falls_back() {
        assert_eq!(device_label("MacIntel"), "Mac");
        assert_eq!(device_label("Win32"), "Windows");
        assert_eq!(device_label("Linux x86_64"), "Linux");
        assert_eq!(device_label(""), "this device");
    }

    fn line(op: DiffOp, text: &str) -> DiffLine {
        DiffLine {
            op,
            text: text.to_owned(),
        }
    }

    fn row(value: Value) -> Map<String, Value> {
        (match value {
            serde_json::Value::Object(map) => Some(map),
            _ => None,
        })
        .unwrap_or_default()
    }

    #[test]
    fn group_hunks_numbers_changed_runs_and_keeps_unchanged_runs_apart() {
        let lines = vec![
            line(DiffOp::Same, "a"),
            line(DiffOp::Ours, "b"),
            line(DiffOp::Theirs, "c"),
            line(DiffOp::Same, "d"),
            line(DiffOp::Ours, "e"),
        ];
        let groups = group_hunks(&lines);
        let hunks: Vec<Option<u32>> = groups.iter().map(|g| g.hunk).collect();
        assert_eq!(hunks, vec![None, Some(0), None, Some(1)]);
        assert_eq!(groups[1].lines.len(), 2);
    }

    #[test]
    fn is_settled_needs_a_pick_for_every_hunk_and_no_markers_in_edits() {
        let ours = "one\ntwo\n";
        let theirs = "uno\ndos\n";
        assert!(!is_settled(None, ours, theirs));
        assert!(is_settled(Some(&Choice::Local), ours, theirs));
        let none_picked = Choice::Hunks {
            picks: BTreeMap::new(),
        };
        assert!(!is_settled(Some(&none_picked), ours, theirs));
        let all_picked = Choice::Hunks {
            picks: BTreeMap::from([("0".to_owned(), "ours".to_owned())]),
        };
        assert!(is_settled(Some(&all_picked), ours, theirs));
        let with_markers = Choice::Edit {
            text: format!("{MARKER_OURS}\nx\n{MARKER_THEIRS}"),
        };
        assert!(!is_settled(Some(&with_markers), ours, theirs));
    }

    #[test]
    fn device_markers_name_the_two_sides() {
        let out = device_markers("a\n", "b\n");
        assert!(out.contains("<<<<<<< this device"));
        assert!(out.contains(">>>>>>> cloud"));
        assert!(!out.contains(MARKER_OURS));
    }

    #[test]
    fn kind_of_turns_tables_into_singular_labels() {
        assert_eq!(kind_of("vault_pages"), "Note");
        assert_eq!(kind_of("experiments"), "Experiment");
        assert_eq!(kind_of("reading_lists"), "Reading list");
    }

    #[test]
    fn name_of_prefers_title_and_falls_back_to_untitled() {
        assert_eq!(
            name_of(
                &row(json!({"title": "  "})),
                Some(&row(json!({"name": "Pilot"})))
            ),
            "Pilot"
        );
        assert_eq!(name_of(&row(json!({})), None), "Untitled");
        let long = "x".repeat(80);
        let cut = name_of(&row(json!({"title": long})), None);
        assert_eq!(cut.encode_utf16().count(), NAME_LIMIT + 1);
        assert!(cut.ends_with('\u{2026}'));
    }

    #[test]
    fn humanize_drops_id_and_capitalises() {
        assert_eq!(humanize("project_id"), "Project");
        assert_eq!(humanize("due_date"), "Due date");
    }

    #[test]
    fn plural_uses_the_given_or_default_plural() {
        assert_eq!(plural(1, "conflict", None), "1 conflict");
        assert_eq!(plural(3, "conflict", None), "3 conflicts");
        assert_eq!(plural(2, "try", Some("tries")), "2 tries");
    }

    #[test]
    fn unique_device_name_counts_up_past_taken_labels() {
        assert_eq!(
            unique_device_name("Thesis", "desktop", &[]),
            "Thesis (desktop)"
        );
        let taken = vec![
            "Thesis (desktop)".to_owned(),
            "Thesis (desktop 2)".to_owned(),
        ];
        assert_eq!(
            unique_device_name("Thesis", "desktop", &taken),
            "Thesis (desktop 3)"
        );
    }
}
