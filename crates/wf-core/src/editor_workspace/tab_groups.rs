//! Tab groups: a named, coloured run of tabs in one pane's strip that can fold
//! behind a single chip. A group belongs to its pane; a tab carried to another
//! pane leaves it behind. Port of `application/tab-groups.ts`.

use serde::{Deserialize, Serialize};

use super::pane_tree::{PaneLeaf, TabRef};

/// The six tag tones every theme defines (`data-tag-tone`).
pub const GROUP_COLORS: [u8; 6] = [1, 2, 3, 4, 5, 6];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct TabGroup {
    pub id: String,
    /// May be empty: the chip then shows only its colour.
    pub name: String,
    /// One of `GROUP_COLORS`.
    pub color: u8,
    /// Only stored when true.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collapsed: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(tag = "group", rename_all = "lowercase")]
pub enum TabGroupCommand {
    New,
    Join { id: String },
    Leave,
    Toggle,
    Rename { name: String },
    Color { color: u8 },
    Dissolve,
}

/// One tab's place in a strip: where a chip goes and which tabs fold away.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "specta", derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct TabRun {
    /// Set on the first tab of a group's run: draw the group's chip before it.
    pub chip: Option<TabGroup>,
    /// In a folded group and not the open tab.
    pub hidden: bool,
    /// Tabs in the run, when `chip` is set; else 0.
    pub size: i32,
}

/// Drop the group mark from a tab.
#[must_use]
pub fn without_group(tab: &TabRef) -> TabRef {
    TabRef {
        group: None,
        ..tab.clone()
    }
}

fn groups_of(leaf: &PaneLeaf) -> Vec<TabGroup> {
    leaf.groups.clone().unwrap_or_default()
}

/// The group a tab is in, if that group still exists in its pane.
fn group_of<'a>(leaf: &'a PaneLeaf, tab: &TabRef) -> Option<&'a TabGroup> {
    let id = tab.group.as_deref()?;
    leaf.groups.as_ref()?.iter().find(|g| g.id == id)
}

/// Drop groups no tab is in, and group marks that name no group.
#[must_use]
pub fn clean_groups(leaf: &PaneLeaf) -> PaneLeaf {
    let used: Vec<TabGroup> = groups_of(leaf)
        .into_iter()
        .filter(|g| leaf.tabs.iter().any(|t| t.group.as_deref() == Some(g.id.as_str())))
        .collect();
    let tabs = leaf
        .tabs
        .iter()
        .map(|t| {
            let kept = used.iter().any(|g| t.group.as_deref() == Some(g.id.as_str()));
            if kept { t.clone() } else { without_group(t) }
        })
        .collect();
    PaneLeaf {
        tabs,
        groups: Some(used),
        ..leaf.clone()
    }
}

/// Move the tab at `from` to sit right after the last tab matching `after`.
fn move_after(leaf: &PaneLeaf, from: i32, tab: TabRef, after: impl Fn(&TabRef) -> bool) -> PaneLeaf {
    let active = tab_at_leaf(leaf, leaf.active_index).cloned();
    let rest: Vec<TabRef> = leaf
        .tabs
        .iter()
        .enumerate()
        .filter(|(i, _)| *i as i32 != from)
        .map(|(_, t)| t.clone())
        .collect();
    let mut at = from;
    for (i, t) in rest.iter().enumerate() {
        if after(t) {
            at = i as i32 + 1;
        }
    }
    let at_usize = at.clamp(0, rest.len() as i32) as usize;
    let mut tabs = rest.clone();
    tabs.insert(at_usize, tab);
    let active_index = if leaf.active_index == from {
        at
    } else {
        active
            .and_then(|a| tabs.iter().position(|t| *t == a))
            .map_or(0, |i| i as i32)
    };
    PaneLeaf {
        tabs,
        active_index: active_index.max(0),
        ..leaf.clone()
    }
}

fn next_id(groups: &[TabGroup]) -> String {
    let taken = groups
        .iter()
        .filter_map(|g| g.id.get(1..).and_then(|n| n.parse::<f64>().ok()))
        .filter(|n| n.is_finite())
        .fold(0.0_f64, f64::max);
    format!("g{}", taken + 1.0)
}

fn edit_group(leaf: &PaneLeaf, id: &str, edit: impl Fn(&TabGroup) -> TabGroup) -> PaneLeaf {
    PaneLeaf {
        groups: Some(
            groups_of(leaf)
                .iter()
                .map(|g| if g.id == id { edit(g) } else { g.clone() })
                .collect(),
        ),
        ..leaf.clone()
    }
}

fn tab_at_leaf(leaf: &PaneLeaf, index: i32) -> Option<&TabRef> {
    usize::try_from(index).ok().and_then(|i| leaf.tabs.get(i))
}

/// Apply a group command to the tab at `index`; unchanged when it does not apply.
#[must_use]
pub fn apply_group_command(leaf: &PaneLeaf, index: i32, command: &TabGroupCommand) -> PaneLeaf {
    let Some(tab) = tab_at_leaf(leaf, index).cloned() else {
        return leaf.clone();
    };
    let groups = groups_of(leaf);
    let current = group_of(leaf, &tab).cloned();

    match command {
        TabGroupCommand::New => {
            let id = next_id(&groups);
            let created = TabGroup {
                id: id.clone(),
                name: String::new(),
                color: GROUP_COLORS[groups.len() % GROUP_COLORS.len()],
                collapsed: None,
            };
            let tabs = leaf
                .tabs
                .iter()
                .enumerate()
                .map(|(i, t)| {
                    if i as i32 == index {
                        TabRef {
                            group: Some(id.clone()),
                            ..t.clone()
                        }
                    } else {
                        t.clone()
                    }
                })
                .collect();
            let mut next_groups = groups;
            next_groups.push(created);
            clean_groups(&PaneLeaf {
                tabs,
                groups: Some(next_groups),
                ..leaf.clone()
            })
        }
        TabGroupCommand::Join { id } => {
            let exists = groups.iter().any(|g| g.id == *id);
            if !exists || current.as_ref().is_some_and(|c| c.id == *id) {
                return leaf.clone();
            }
            let moved = TabRef {
                group: Some(id.clone()),
                ..tab
            };
            let target = id.clone();
            clean_groups(&move_after(leaf, index, moved, |t| t.group.as_deref() == Some(target.as_str())))
        }
        _ => {
            let Some(current) = current else {
                return leaf.clone();
            };
            let current_id = current.id.clone();
            match command {
                TabGroupCommand::Leave => clean_groups(&move_after(leaf, index, without_group(&tab), |t| {
                    t.group.as_deref() == Some(current_id.as_str())
                })),
                TabGroupCommand::Toggle => edit_group(leaf, &current_id, |g| TabGroup {
                    collapsed: if g.collapsed == Some(true) { None } else { Some(true) },
                    ..g.clone()
                }),
                TabGroupCommand::Rename { name } => edit_group(leaf, &current_id, |g| TabGroup {
                    name: name.trim().to_owned(),
                    ..g.clone()
                }),
                TabGroupCommand::Color { color } => edit_group(leaf, &current_id, |g| TabGroup {
                    color: *color,
                    ..g.clone()
                }),
                TabGroupCommand::Dissolve => clean_groups(&PaneLeaf {
                    tabs: leaf
                        .tabs
                        .iter()
                        .map(|t| {
                            if t.group.as_deref() == Some(current_id.as_str()) {
                                without_group(t)
                            } else {
                                t.clone()
                            }
                        })
                        .collect(),
                    ..leaf.clone()
                }),
                TabGroupCommand::New | TabGroupCommand::Join { .. } => unreachable!("handled above"),
            }
        }
    }
}

/// How to draw each tab of a strip: where chips go and which tabs fold away.
#[must_use]
pub fn group_runs(leaf: &PaneLeaf) -> Vec<TabRun> {
    leaf.tabs
        .iter()
        .enumerate()
        .map(|(index, tab)| {
            let Some(group) = group_of(leaf, tab) else {
                return TabRun {
                    chip: None,
                    hidden: false,
                    size: 0,
                };
            };
            let index_i = index as i32;
            let hidden = group.collapsed == Some(true) && index_i != leaf.active_index;
            let same = |t: &TabRef| t.group.as_deref() == Some(group.id.as_str());
            if index > 0 && leaf.tabs.get(index - 1).is_some_and(same) {
                return TabRun {
                    chip: None,
                    hidden,
                    size: 0,
                };
            }
            let size = leaf.tabs[index..].iter().take_while(|t| same(t)).count() as i32;
            TabRun {
                chip: Some(group.clone()),
                hidden,
                size,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::editor_workspace::pane_tree::{
        empty_layout, layout_for_tab_menu, leaves, move_tab, open_tab, split_pane, DocumentMode,
        PaneLayout, SplitDirection, TabMenuCommand, DEFAULT_PANE_ID,
    };

    fn tab(id: &str) -> TabRef {
        TabRef {
            kind: "vault_page".to_owned(),
            id: id.to_owned(),
            mode: None,
            group: None,
        }
    }
    fn abcd() -> PaneLayout {
        ["a", "b", "c", "d"]
            .iter()
            .fold(empty_layout(DEFAULT_PANE_ID), |layout, id| {
                open_tab(&layout, &tab(id), DEFAULT_PANE_ID)
            })
    }
    fn run(layout: &PaneLayout, index: i32, command: TabGroupCommand) -> PaneLayout {
        layout_for_tab_menu(
            layout,
            DEFAULT_PANE_ID,
            index,
            &TabMenuCommand::Group(command),
            "pane-2",
        )
    }
    fn first(layout: &PaneLayout) -> PaneLeaf {
        leaves(&layout.root)[0].clone()
    }
    fn ids(layout: &PaneLayout) -> Vec<String> {
        first(layout).tabs.iter().map(|t| t.id.clone()).collect()
    }
    fn marks(layout: &PaneLayout) -> Vec<String> {
        first(layout)
            .tabs
            .iter()
            .map(|t| t.group.clone().unwrap_or_else(|| "-".to_owned()))
            .collect()
    }
    fn strs(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| (*s).to_owned()).collect()
    }
    fn group(id: &str, name: &str, color: u8) -> TabGroup {
        TabGroup {
            id: id.to_owned(),
            name: name.to_owned(),
            color,
            collapsed: None,
        }
    }
    /// (chip id, hidden) per run, the shape the TS test compared.
    fn chips(leaf: &PaneLeaf) -> Vec<(Option<String>, bool)> {
        group_runs(leaf)
            .iter()
            .map(|r| (r.chip.as_ref().map(|c| c.id.clone()), r.hidden))
            .collect()
    }

    #[test]
    fn a_new_group_holds_the_clicked_tab_and_gets_the_next_colour() {
        let one = run(&abcd(), 1, TabGroupCommand::New);
        assert_eq!(marks(&one), strs(&["-", "g1", "-", "-"]));
        assert_eq!(first(&one).groups, Some(vec![group("g1", "", 1)]));

        let two = run(&one, 3, TabGroupCommand::New);
        assert_eq!(marks(&two), strs(&["-", "g1", "-", "g2"]));
        assert_eq!(first(&two).groups.unwrap()[1].color, 2);
    }

    #[test]
    fn joining_a_group_moves_the_tab_next_to_the_groups_last_tab() {
        let grouped = run(&abcd(), 0, TabGroupCommand::New);
        let joined = run(
            &grouped,
            3,
            TabGroupCommand::Join {
                id: "g1".to_owned(),
            },
        );
        assert_eq!(ids(&joined), strs(&["a", "d", "b", "c"]));
        assert_eq!(marks(&joined), strs(&["g1", "g1", "-", "-"]));
    }

    #[test]
    fn leaving_a_group_puts_the_tab_just_after_it_and_an_empty_group_is_dropped() {
        let mut layout = run(&abcd(), 0, TabGroupCommand::New);
        layout = run(
            &layout,
            1,
            TabGroupCommand::Join {
                id: "g1".to_owned(),
            },
        );
        let left = run(&layout, 0, TabGroupCommand::Leave);
        assert_eq!(ids(&left), strs(&["b", "a", "c", "d"]));
        assert_eq!(marks(&left), strs(&["g1", "-", "-", "-"]));

        let gone = run(&left, 0, TabGroupCommand::Leave);
        assert_eq!(marks(&gone), strs(&["-", "-", "-", "-"]));
        assert_eq!(first(&gone).groups, Some(vec![]));
    }

    #[test]
    fn rename_recolour_and_ungroup_all_act_on_the_clicked_tabs_group() {
        let mut layout = run(&abcd(), 0, TabGroupCommand::New);
        layout = run(
            &layout,
            1,
            TabGroupCommand::Join {
                id: "g1".to_owned(),
            },
        );
        layout = run(
            &layout,
            0,
            TabGroupCommand::Rename {
                name: "  Methods ".to_owned(),
            },
        );
        layout = run(&layout, 0, TabGroupCommand::Color { color: 4 });
        assert_eq!(first(&layout).groups, Some(vec![group("g1", "Methods", 4)]));

        let dissolved = run(&layout, 1, TabGroupCommand::Dissolve);
        assert_eq!(marks(&dissolved), strs(&["-", "-", "-", "-"]));
        assert_eq!(ids(&dissolved), strs(&["a", "b", "c", "d"]));
    }

    #[test]
    fn a_group_command_on_an_ungrouped_tab_changes_nothing() {
        let base = abcd();
        assert_eq!(first(&run(&base, 0, TabGroupCommand::Toggle)), first(&base));
        assert_eq!(
            first(&run(
                &base,
                0,
                TabGroupCommand::Join {
                    id: "nope".to_owned()
                }
            )),
            first(&base)
        );
    }

    #[test]
    fn a_folded_group_hides_its_tabs_except_the_open_one_behind_one_chip() {
        let mut layout = run(&abcd(), 0, TabGroupCommand::New);
        layout = run(
            &layout,
            1,
            TabGroupCommand::Join {
                id: "g1".to_owned(),
            },
        );
        let folded = run(&layout, 0, TabGroupCommand::Toggle);
        // d is the open tab, outside the group.
        let runs = group_runs(&first(&folded));
        assert_eq!(
            chips(&first(&folded)),
            vec![
                (Some("g1".to_owned()), true),
                (None, true),
                (None, false),
                (None, false)
            ]
        );
        assert_eq!(runs[0].size, 2);

        let opened = run(&folded, 0, TabGroupCommand::Toggle);
        let hidden: Vec<bool> = group_runs(&first(&opened)).iter().map(|r| r.hidden).collect();
        assert_eq!(hidden, vec![false, false, false, false]);
    }

    #[test]
    fn the_open_tab_of_a_folded_group_stays_visible() {
        let mut layout = run(&abcd(), 2, TabGroupCommand::New);
        layout = run(
            &layout,
            3,
            TabGroupCommand::Join {
                id: "g1".to_owned(),
            },
        );
        let folded = run(&layout, 2, TabGroupCommand::Toggle);
        let hidden: Vec<bool> = group_runs(&first(&folded)).iter().map(|r| r.hidden).collect();
        assert_eq!(hidden, vec![false, false, true, false]);
    }

    #[test]
    fn a_tab_carried_to_another_pane_leaves_its_group_behind() {
        let grouped = run(&abcd(), 0, TabGroupCommand::New);
        let split = split_pane(&grouped, DEFAULT_PANE_ID, SplitDirection::Row, "pane-2");
        let moved = move_tab(&split, DEFAULT_PANE_ID, 0, "pane-2", None);
        for pane in leaves(&moved.root) {
            for t in &pane.tabs {
                assert_eq!(t.group, None, "{}", pane.id);
            }
        }
        let ink = TabRef {
            kind: "k".to_owned(),
            id: "i".to_owned(),
            mode: Some(DocumentMode::Ink),
            group: Some("g1".to_owned()),
        };
        assert_eq!(
            without_group(&ink),
            TabRef {
                kind: "k".to_owned(),
                id: "i".to_owned(),
                mode: Some(DocumentMode::Ink),
                group: None,
            }
        );
    }

    #[test]
    fn a_tab_naming_a_group_that_is_not_there_reads_as_ungrouped() {
        let stale = PaneLeaf {
            id: "p".to_owned(),
            tabs: vec![TabRef {
                group: Some("gone".to_owned()),
                ..tab("a")
            }],
            active_index: 0,
            groups: None,
        };
        assert_eq!(
            group_runs(&stale),
            vec![TabRun {
                chip: None,
                hidden: false,
                size: 0,
            }]
        );
    }
}
