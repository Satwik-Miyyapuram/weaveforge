# app_lib

Small pure rules from `apps/web/src/lib`: palette rows, saved preference defaults, shortcut toggles,
page body fallbacks and key-event checks. Storage, DOM access, React state and locale sorts stay in TS.

- `menu_palette::menu_palette_actions`: palette rows backed by the desktop menu, in palette order; first enabled item per id; one trailing `…` stripped.
- `menu_palette::settings_palette_rows`: Settings palette rows the bridge can back (deadlines widget, pen).
- `shortcuts::next_shortcuts_open`: `toggle` flips the sheet; any other request opens it.
- `prefs::ink_haptics_on`: only the saved value `off` turns haptics off; missing is on.
- `prefs::citation_format_storage_key`: `thesis.citeFormat.<project or global>`.
- `prefs::parse_editor_citation_format`: saved format if offered, else `wikilink`.
- `prefs::parse_wikilink_create_mode`: `never` or `create` (default).
- `page_text::body_text`: full body when non-empty, else preview, else empty.
- `page_text::is_hydrated_page`: body present and no non-empty preview.
  Cap: the wasm exports no longer throw over the 16Mi UTF-16 cap. The TS wrappers
  (`apps/web/src/lib/parts.ts`) check `textWithinCap` first and, above the
  cap, keep the old TS rule (`full || preview || ""`; `!preview` for hydration).
- `page_text` non-string preview: a truthy non-string `bodyPreview` is not a
  stand-in, so `isHydratedPage` returns false before the Rust call, matching the
  original `!("bodyPreview" in page && page.bodyPreview)` rule.
- `menu_palette::MenuItem` / `MenuGroup`: serde defaults (`""`, `false`, `[]`) for
  missing fields, so a missing field is skipped rather than failing the call.
- `commit_enter::is_commit_enter`: Enter that is not an IME composition (keyCode 229 excluded).
- `edit_menu::is_edit_command`: `edit-paste` or one of the five execCommand edit commands.

WASM exports (`crates/wf-wasm/src/app_lib.rs`): `menuPaletteActions`, `settingsPaletteRows`,
`nextShortcutsOpen`, `inkHapticsOn`, `citationFormatStorageKey`, `parseEditorCitationFormat`,
`parseWikilinkCreateMode`, `noteBodyText`, `isHydratedPage`, `textWithinCap`, `isCommitEnter`,
`isEditCommand`. TS wrapper: `packages/wf-wasm/src/app-lib.ts`.

Left in TS: DOCS_URL and window event dispatch (`requestShortcuts`), localStorage read/write for
the three preferences, the `useWikilinkCreateMode` hook, `mergeServerAppearance` (object spread over
typed fields), and `takenTitles` in `apps/web/src/features/wiki/application/wiki-build.ts` (a plain
`pages.map((page) => page.title)` projection with no rule to port).
`hasResultsTables` moved to Rust: see `report-results-tables.md`.

Source: `apps/web/src/lib/palette-actions.ts`, `apps/web/src/lib/parts.ts`,
`apps/web/src/lib/parts.ts`, `apps/web/src/lib/parts.ts`,
`apps/web/src/lib/wikilink-create-preference.ts`, `apps/web/src/lib/parts.ts`,
`apps/web/src/lib/desktop/menu-edit.ts`.
