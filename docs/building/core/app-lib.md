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
- `toast_store::reduce`: the pure transitions of the toast store (`apps/web/src/lib/toast/parts.ts`). State in,
  `Reduction` out: the new state, the effects to run (start/stop a timer, run a commit, commit), the visible
  list, the hidden count, and `changed`. `TOAST_MS` 8000 and `MAX_TOASTS` 3 live here. Timers, closures per id,
  commit promises and listeners stay in TS. Wasm exports `toastInitialState` and `toastReduce` in
  `crates/wf-wasm/src/app_lib.rs`, typed `unknown` until `npm run bindings`. 11 Rust `#[test]`s.
- `context_menu::reduce` and `context_menu::place`: whether a right-click menu open or close changes state
  (no open without items; close only when open), and where a menu goes on screen (flip, then clamp to
  `VIEWPORT_PAD` 12). Items, listeners and the DOM stay in `apps/web/src/components/context-menu-store.ts`.
  Wasm exports `contextMenuReduce` and `contextMenuPlace` in `crates/wf-wasm/src/app_nav.rs`. 6 Rust `#[test]`s.
- `reveal_nav::scroll_top_to_reveal`: the `scrollTop` that shows the active sidebar row whole
  (`apps/web/src/app/reveal-active-nav.ts`). The DOM rectangle reads and the `scrollTop` write stay in TS.
  Wasm export `navRevealScrollTop` in `crates/wf-wasm/src/app_nav.rs`. 3 Rust `#[test]`s.

WASM exports (`crates/wf-wasm/src/app_lib.rs`): `menuPaletteActions`, `settingsPaletteRows`,
`nextShortcutsOpen`, `inkHapticsOn`, `citationFormatStorageKey`, `parseEditorCitationFormat`,
`parseWikilinkCreateMode`, `noteBodyText`, `isHydratedPage`, `textWithinCap`, `isCommitEnter`,
`isEditCommand`, `execCommandName` (edit command to `execCommand` id, in `edit_menu.rs`) and
`isAppStorageKey` (`crates/wf-core/src/app_lib/storage_keys.rs`, the sign-out wipe rule from
`clear-local-device-data.ts`). TS wrapper: `packages/wf-wasm/src/app-lib.ts`.

Left in TS: DOCS_URL and window event dispatch (`requestShortcuts`), localStorage read/write for
the three preferences, the `useWikilinkCreateMode` hook, `mergeServerAppearance` (object spread over
typed fields), and `takenTitles` in `apps/web/src/features/wiki/application/wiki-build.ts` (a plain
`pages.map((page) => page.title)` projection with no rule to port).
`hasResultsTables` moved to Rust: see `report-results-tables.md`.

Source: `apps/web/src/lib/parts-2.ts`, `apps/web/src/lib/parts.ts`,
`apps/web/src/lib/parts.ts`, `apps/web/src/lib/parts.ts`,
`apps/web/src/lib/wikilink-create-preference.ts`, `apps/web/src/lib/parts.ts`,
`apps/web/src/lib/desktop/menu-edit.ts`, `apps/web/src/lib/desktop/clear-local-device-data.ts`.

## More app_lib modules

| Module | Rust fn | wasm export | TS caller |
| --- | --- | --- | --- |
| `commit_enter` | `is_commit_enter` | `isCommitEnter` | `apps/web/src/lib/parts.ts` |
| `context_menu` | `reduce`, `place`, `VIEWPORT_PAD` | `contextMenuReduce`, `contextMenuPlace` | `apps/web/src/components/context-menu-store.ts` |
| `menu_palette` | `menu_palette_actions`, `settings_palette_rows` | `menuPaletteActions`, `settingsPaletteRows` | `apps/web/src/lib/parts-2.ts` |
| `prefs` | `ink_haptics_on`, `citation_format_storage_key`, `parse_editor_citation_format`, `parse_wikilink_create_mode` | `inkHapticsOn`, `citationFormatStorageKey`, `parseEditorCitationFormat`, `parseWikilinkCreateMode` | `apps/web/src/lib/parts.ts`, `apps/web/src/lib/hooks/parts.ts`, `apps/web/src/lib/wikilink-create-preference.ts` |
| `reveal_nav` | `scroll_top_to_reveal` | `navRevealScrollTop` | `apps/web/src/app/reveal-active-nav.ts` |
| `shortcuts` | `next_shortcuts_open` | `nextShortcutsOpen` | `apps/web/src/lib/parts-2.ts`, `apps/web/src/components/shortcuts-host.tsx` |
| `toast_store` | `initial_state`, `reduce`, `TOAST_MS`, `MAX_TOASTS` | `toastInitialState`, `toastReduce` | `apps/web/src/lib/toast/parts.ts` |

The rules for these modules are in the list at the top of this page.
