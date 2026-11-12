//! Small pure rules from `apps/web/src/lib` (the app's shared helpers): palette rows, saved
//! preference defaults, shortcut toggles, page body fallbacks and key-event checks. Storage, DOM
//! access and locale sorting stay in TS.

pub mod commit_enter;
pub mod context_menu;
pub mod edit_menu;
pub mod menu_palette;
pub mod page_text;
pub mod prefs;
pub mod reveal_nav;
pub mod shortcuts;
pub mod toast_store;
pub mod storage_keys;
