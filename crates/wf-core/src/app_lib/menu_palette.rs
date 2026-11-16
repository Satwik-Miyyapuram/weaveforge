//! Command palette rows that the desktop shell's menu and Settings back (TS `menuPaletteActions`
//! and `settingsPaletteActions` in `apps/web/src/lib/parts-2.ts`).

use serde::{Deserialize, Serialize};

/// The menu entries the palette offers, in palette order. The shell gives these stable ids.
pub const PALETTE_MENU_IDS: [&str; 4] = [
    "action:check-updates",
    "action:docs",
    "action:show-in-explorer",
    "action:choose-workspace",
];

/// One entry of a desktop menu group, as the shell sends it. A missing field takes its default
/// (`""` or `false`), so an entry without an `enabled` flag is skipped rather than rejected.
#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize)]
#[serde(default)]
pub struct MenuItem {
    /// Stable menu id, such as `action:docs`.
    pub id: String,
    /// Label as shown in the menu; may end in `…`.
    pub label: String,
    /// Whether the menu item can be run now.
    pub enabled: bool,
}

/// One desktop menu group and its items. A missing `items` list is empty.
#[derive(Debug, Clone, PartialEq, Eq, Default, Deserialize)]
#[serde(default)]
pub struct MenuGroup {
    /// Items in menu order.
    pub items: Vec<MenuItem>,
}

/// A palette row backed by a menu item.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MenuPaletteRow {
    /// The menu item id the row runs.
    pub id: String,
    /// The label without a trailing `…`.
    pub label: String,
}

/// A palette row that opens a desktop-only Settings section.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SettingsPaletteRow {
    /// Stable row key.
    pub key: String,
    /// Label shown in the palette.
    pub label: String,
    /// App path to open, with its anchor.
    pub path: String,
}

/// The palette rows the menu backs, in [`PALETTE_MENU_IDS`] order. Each id takes the first enabled
/// item with that id across all groups; a missing or disabled id gives no row. Empty groups give
/// no rows.
#[must_use]
pub fn menu_palette_actions(groups: &[MenuGroup]) -> Vec<MenuPaletteRow> {
    let items: Vec<&MenuItem> = groups.iter().flat_map(|group| group.items.iter()).collect();
    PALETTE_MENU_IDS
        .iter()
        .filter_map(|id| {
            items
                .iter()
                .find(|entry| entry.id == *id && entry.enabled)
                .map(|item| MenuPaletteRow {
                    id: (*id).to_owned(),
                    label: item
                        .label
                        .strip_suffix('…')
                        .unwrap_or(&item.label)
                        .to_owned(),
                })
        })
        .collect()
}

/// The Settings rows the bridge can back: the deadlines widget when `has_plan_widget`, the pen
/// settings when `has_ink`. A browser passes neither and gets no rows.
#[must_use]
pub fn settings_palette_rows(has_plan_widget: bool, has_ink: bool) -> Vec<SettingsPaletteRow> {
    let mut rows = Vec::new();
    if has_plan_widget {
        rows.push(SettingsPaletteRow {
            key: "settings:plan-widget".to_owned(),
            label: "Desktop deadlines widget".to_owned(),
            path: "/settings#settings-calendar".to_owned(),
        });
    }
    if has_ink {
        rows.push(SettingsPaletteRow {
            key: "settings:pen".to_owned(),
            label: "Pen and handwriting settings".to_owned(),
            path: "/settings#settings-editor".to_owned(),
        });
    }
    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, label: &str, enabled: bool) -> MenuItem {
        MenuItem {
            id: id.to_owned(),
            label: label.to_owned(),
            enabled,
        }
    }

    #[test]
    fn rows_follow_palette_order_and_strip_ellipsis() {
        let groups = vec![
            MenuGroup {
                items: vec![
                    item("action:choose-workspace", "Choose workspace…", true),
                    item("action:docs", "Documentation", true),
                ],
            },
            MenuGroup {
                items: vec![item("action:check-updates", "Check for updates…", true)],
            },
        ];
        let rows = menu_palette_actions(&groups);
        let ids: Vec<&str> = rows.iter().map(|row| row.id.as_str()).collect();
        assert_eq!(
            ids,
            [
                "action:check-updates",
                "action:docs",
                "action:choose-workspace"
            ]
        );
        assert_eq!(rows[0].label, "Check for updates");
        assert_eq!(rows[2].label, "Choose workspace");
    }

    #[test]
    fn disabled_or_unknown_ids_give_no_row() {
        let groups = vec![MenuGroup {
            items: vec![
                item("action:docs", "Docs", false),
                item("edit-copy", "Copy", true),
            ],
        }];
        assert!(menu_palette_actions(&groups).is_empty());
        assert!(menu_palette_actions(&[]).is_empty());
    }

    #[test]
    fn missing_fields_are_skipped_not_rejected() {
        let groups: Vec<MenuGroup> = serde_json::from_str(
            r#"[
                {"items": [{"id": "action:docs", "label": "Docs"}]},
                {},
                {"items": [{"id": "action:check-updates", "label": "Check…", "enabled": true}]}
            ]"#,
        )
        .expect("missing fields must not fail deserialisation");
        let rows = menu_palette_actions(&groups);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "action:check-updates");
    }

    #[test]
    fn only_one_ellipsis_is_stripped() {
        let groups = vec![MenuGroup {
            items: vec![item("action:docs", "Docs……", true)],
        }];
        assert_eq!(menu_palette_actions(&groups)[0].label, "Docs…");
    }

    #[test]
    fn first_enabled_match_wins() {
        let groups = vec![MenuGroup {
            items: vec![
                item("action:docs", "Off", false),
                item("action:docs", "On", true),
            ],
        }];
        assert_eq!(menu_palette_actions(&groups)[0].label, "On");
    }

    #[test]
    fn settings_rows_follow_bridge_flags() {
        assert!(settings_palette_rows(false, false).is_empty());
        let both = settings_palette_rows(true, true);
        assert_eq!(both.len(), 2);
        assert_eq!(both[0].key, "settings:plan-widget");
        assert_eq!(both[1].path, "/settings#settings-editor");
        let pen_only = settings_palette_rows(false, true);
        assert_eq!(pen_only.len(), 1);
        assert_eq!(pen_only[0].key, "settings:pen");
    }
}
