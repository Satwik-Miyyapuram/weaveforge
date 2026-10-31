//! Tests for the app menu model and actions (ported from apps/desktop/src/app-menu.ts).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::cell::{Cell, RefCell};
use std::collections::HashSet;

use weaveforge_shell::menu::{
    BAD_TITLE_BAR_COLOR, MenuGroup, MenuHost, MenuItem, MenuItemKind, MenuRole, NOT_AVAILABLE,
    PAGE_COMMAND_EVENT, accelerator_label, check_title_bar_colors, menu_invoke, menu_model,
};

/// Records every native action the menu asks for, instead of doing it.
#[derive(Default)]
struct FakeHost {
    calls: RefCell<Vec<String>>,
    maximized: Cell<bool>,
    fullscreen: Cell<bool>,
    root: Option<String>,
    version: String,
}

impl MenuHost for FakeHost {
    fn choose_workspace(&self) {
        self.calls.borrow_mut().push("choose_workspace".to_owned());
    }

    fn show_in_explorer(&self) {
        self.calls.borrow_mut().push("show_in_explorer".to_owned());
    }

    fn open_docs(&self) {
        self.calls.borrow_mut().push("open_docs".to_owned());
    }

    fn check_updates(&self) {
        self.calls.borrow_mut().push("check_updates".to_owned());
    }

    fn app_version(&self) -> String {
        self.version.clone()
    }

    fn go_to(&self, route: &str) {
        self.calls.borrow_mut().push(format!("go_to:{route}"));
    }

    fn page_command(&self, command: &str) {
        self.calls
            .borrow_mut()
            .push(format!("page_command:{command}"));
    }

    fn role(&self, role: MenuRole) {
        self.calls.borrow_mut().push(format!("role:{role:?}"));
    }

    fn is_maximized(&self) -> bool {
        self.maximized.get()
    }

    fn is_fullscreen(&self) -> bool {
        self.fullscreen.get()
    }

    fn workspace_root(&self) -> Option<String> {
        self.root.clone()
    }
}

fn calls(host: &FakeHost) -> Vec<String> {
    host.calls.borrow().clone()
}

fn group<'a>(groups: &'a [MenuGroup], label: &str) -> &'a MenuGroup {
    groups.iter().find(|g| g.label == label).expect("group")
}

fn item<'a>(groups: &'a [MenuGroup], group_label: &str, label: &str) -> &'a MenuItem {
    group(groups, group_label)
        .items
        .iter()
        .find(|i| i.label == label)
        .expect("item")
}

fn id_of(groups: &[MenuGroup], group_label: &str, label: &str) -> String {
    item(groups, group_label, label).id.clone()
}

fn by_id<'a>(groups: &'a [MenuGroup], id: &str) -> &'a MenuItem {
    groups
        .iter()
        .flat_map(|g| g.items.iter())
        .find(|i| i.id == id)
        .expect("id")
}

// The menu asks the page through a DOM event, not IPC, so the two names must match.
#[test]
fn page_command_event_is_the_name_the_title_bar_listens_for() {
    let title_bar = include_str!("../../web/src/components/desktop-title-bar.tsx");
    assert!(title_bar.contains("const MENU_COMMAND_EVENT = \"weaveforge:menu-command\";"));
    assert_eq!(PAGE_COMMAND_EVENT, "weaveforge:menu-command");
}

#[test]
fn menu_groups_are_file_edit_go_view_window_help() {
    let labels: Vec<String> = menu_model(&FakeHost::default())
        .into_iter()
        .map(|g| g.label)
        .collect();
    assert_eq!(labels, ["File", "Edit", "Go", "View", "Window", "Help"]);
}

#[test]
fn every_entry_has_an_id_and_only_the_settings_route_is_repeated() {
    let groups = menu_model(&FakeHost::default());
    let ids: Vec<&str> = groups
        .iter()
        .flat_map(|g| g.items.iter())
        .map(|i| i.id.as_str())
        .collect();
    assert!(ids.iter().all(|id| !id.is_empty()));
    // The TS menu gives Settings an id in both File and Go; the port keeps that.
    let mut seen = HashSet::new();
    let dups: Vec<&str> = ids.iter().copied().filter(|id| !seen.insert(*id)).collect();
    assert_eq!(dups, ["route:/settings"]);
}

#[test]
fn route_entries_call_go_to_with_their_route() {
    let cases = [
        ("route:/settings", "/settings"),
        ("route:/papers", "/papers"),
        ("route:/report/overleaf", "/report/overleaf"),
        ("route:/dashboard", "/dashboard"),
    ];
    for (id, route) in cases {
        let host = FakeHost::default();
        menu_invoke(&host, id).expect("invoke");
        assert_eq!(calls(&host), [format!("go_to:{route}")]);
    }
}

#[test]
fn search_entry_calls_page_command_search() {
    let host = FakeHost::default();
    menu_invoke(&host, "page:search").expect("invoke");
    assert_eq!(calls(&host), ["page_command:search"]);
    let groups = menu_model(&host);
    assert_eq!(
        item(&groups, "Go", "Search…").accelerator.as_deref(),
        Some("Ctrl+K")
    );
    assert_eq!(
        item(&groups, "Go", "Search…").command.as_deref(),
        Some("search")
    );
}

#[test]
fn edit_entries_run_their_roles() {
    let host = FakeHost::default();
    let groups = menu_model(&host);
    for (label, role) in [
        ("Undo", "Undo"),
        ("Copy", "Copy"),
        ("Select all", "SelectAll"),
    ] {
        menu_invoke(&host, &id_of(&groups, "Edit", label)).expect("invoke");
        assert_eq!(
            calls(&host).last().map(String::as_str),
            Some(format!("role:{role}").as_str())
        );
    }
}

#[test]
fn maximize_label_flips_with_window_state() {
    let host = FakeHost::default();
    assert_eq!(
        item(&menu_model(&host), "Window", "Maximize").id,
        "window:maximize"
    );
    host.maximized.set(true);
    let groups = menu_model(&host);
    assert_eq!(by_id(&groups, "window:maximize").label, "Restore");
    menu_invoke(&host, "window:maximize").expect("invoke");
    assert_eq!(calls(&host), ["role:Maximize"]);
}

#[test]
fn workspace_entry_shows_the_folder_name_and_is_disabled() {
    let cases = [
        ("C:\\Users\\Satwik\\Thesis", "Workspace: Thesis"),
        ("D:\\papers\\MSc\\", "Workspace: MSc"),
        ("/home/u/vault/", "Workspace: vault"),
        ("/", "Workspace: /"),
    ];
    for (root, label) in cases {
        let host = FakeHost {
            root: Some(root.to_owned()),
            ..Default::default()
        };
        let groups = menu_model(&host);
        let entry = by_id(&groups, "info:workspace");
        assert_eq!(entry.label, label);
        assert!(!entry.enabled);
        assert_eq!(entry.kind, MenuItemKind::Item);
    }
}

#[test]
fn workspace_root_block_matches_ts_order() {
    let host = FakeHost {
        root: Some("/home/u/vault".to_owned()),
        ..Default::default()
    };
    let groups = menu_model(&host);
    let file = &group(&groups, "File").items;
    assert_eq!(file[0].label, "Workspace: vault");
    assert_eq!(file[1].label, "Show in file explorer");
    assert_eq!(file[2].label, "Change workspace folder…");
    assert_eq!(file[3].kind, MenuItemKind::Separator);
    assert_eq!(file[4].label, "Settings");
}

#[test]
fn workspace_entries_invoke_their_host_methods() {
    let host = FakeHost {
        root: Some("/home/u/vault".to_owned()),
        ..Default::default()
    };
    let groups = menu_model(&host);
    menu_invoke(&host, &id_of(&groups, "File", "Show in file explorer")).expect("invoke");
    menu_invoke(&host, &id_of(&groups, "File", "Change workspace folder…")).expect("invoke");
    assert_eq!(calls(&host), ["show_in_explorer", "choose_workspace"]);
    let bare = FakeHost::default();
    menu_invoke(
        &bare,
        &id_of(&menu_model(&bare), "File", "Choose workspace folder…"),
    )
    .expect("invoke");
    assert_eq!(calls(&bare), ["choose_workspace"]);
}

#[test]
fn help_group_matches_ts_labels_and_version_is_disabled() {
    let host = FakeHost {
        version: "1.2.3".to_owned(),
        ..Default::default()
    };
    let groups = menu_model(&host);
    let labels: Vec<&str> = group(&groups, "Help")
        .items
        .iter()
        .map(|i| i.label.as_str())
        .collect();
    assert_eq!(
        labels,
        ["Documentation", "", "Check for updates…", "Version 1.2.3"]
    );
    let version = item(&groups, "Help", "Version 1.2.3");
    assert!(!version.enabled);
    assert!(version.label.contains("1.2.3"));
}

#[test]
fn help_entries_invoke_their_host_methods() {
    let host = FakeHost::default();
    let groups = menu_model(&host);
    menu_invoke(&host, &id_of(&groups, "Help", "Documentation")).expect("invoke");
    menu_invoke(&host, &id_of(&groups, "Help", "Check for updates…")).expect("invoke");
    assert_eq!(calls(&host), ["open_docs", "check_updates"]);
}

#[test]
fn no_workspace_root_offers_choose_workspace_first() {
    let groups = menu_model(&FakeHost::default());
    let file = &group(&groups, "File").items;
    assert_eq!(file[0].label, "Choose workspace folder…");
    assert_eq!(file[1].kind, MenuItemKind::Separator);
    assert!(
        groups
            .iter()
            .flat_map(|g| g.items.iter())
            .all(|i| i.id != "info:workspace")
    );
}

#[test]
fn menu_invoke_unknown_separator_and_disabled_ids_are_not_available() {
    let host = FakeHost {
        root: Some("/vault".to_owned()),
        ..Default::default()
    };
    let groups = menu_model(&host);
    let separator = group(&groups, "Edit")
        .items
        .iter()
        .find(|i| i.kind == MenuItemKind::Separator)
        .expect("separator")
        .id
        .clone();
    for id in ["m.9.9", separator.as_str(), "info:workspace"] {
        assert_eq!(menu_invoke(&host, id), Err(NOT_AVAILABLE.to_owned()));
    }
    assert!(calls(&host).is_empty());
}

#[test]
fn separators_have_empty_label_no_accelerator_and_are_disabled() {
    let groups = menu_model(&FakeHost::default());
    let separator = group(&groups, "Edit")
        .items
        .iter()
        .find(|i| i.kind == MenuItemKind::Separator)
        .expect("sep");
    assert_eq!(separator.label, "");
    assert_eq!(separator.accelerator, None);
    assert!(!separator.enabled);
}

#[test]
fn accelerator_labels_follow_the_shortcut_label_rule() {
    assert_eq!(
        accelerator_label("CommandOrControl+X").as_deref(),
        Some("Ctrl+X")
    );
    assert_eq!(
        accelerator_label("CommandOrControl+Plus").as_deref(),
        Some("Ctrl++")
    );
    assert_eq!(accelerator_label(""), None);
    let groups = menu_model(&FakeHost::default());
    assert_eq!(
        item(&groups, "Edit", "Cut").accelerator.as_deref(),
        Some("Ctrl+X")
    );
    assert_eq!(
        item(&groups, "File", "Settings").accelerator.as_deref(),
        Some("Ctrl+,")
    );
}

#[test]
#[cfg(windows)]
fn redo_and_quit_use_electron_role_defaults_on_windows() {
    let groups = menu_model(&FakeHost::default());
    assert_eq!(
        item(&groups, "Edit", "Redo").accelerator.as_deref(),
        Some("Ctrl+Y")
    );
    assert_eq!(item(&groups, "File", "Quit").accelerator, None);
}

#[test]
#[cfg(not(windows))]
fn redo_and_quit_use_electron_role_defaults_elsewhere() {
    let groups = menu_model(&FakeHost::default());
    assert_eq!(
        item(&groups, "Edit", "Redo").accelerator.as_deref(),
        Some("Shift+Ctrl+Z")
    );
    assert_eq!(
        item(&groups, "File", "Quit").accelerator.as_deref(),
        Some("Ctrl+Q")
    );
}

#[test]
fn minimize_and_close_have_no_accelerator() {
    let groups = menu_model(&FakeHost::default());
    assert_eq!(item(&groups, "Window", "Minimize").accelerator, None);
    assert_eq!(item(&groups, "Window", "Close window").accelerator, None);
}

#[test]
fn title_bar_colours_must_be_six_digit_hex() {
    assert_eq!(check_title_bar_colors("#1a2B3c", "#1A2B3C"), Ok(()));
    for bad in ["#123", "123456", "#12345g", ""] {
        assert_eq!(
            check_title_bar_colors(bad, "#101014"),
            Err(BAD_TITLE_BAR_COLOR.to_owned())
        );
        assert_eq!(
            check_title_bar_colors("#101014", bad),
            Err(BAD_TITLE_BAR_COLOR.to_owned())
        );
    }
}
