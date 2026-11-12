# App navigation helpers

These modules hold the pure logic for navigation, palette and shortcut text. They live in `crates/wf-core`; wasm exports in `crates/wf-wasm`; TS keeps the I/O.

| Module | Rust fn | wasm export | TS caller |
| --- | --- | --- | --- |
| `nav_open_groups` | `with_active`, `toggle_group`, `load_open_groups`, `encode_open_groups` | `withActive`, `toggleGroup`, `loadOpenGroups`, `encodeOpenGroups` | `apps/web/src/app/nav-open-groups.ts` |
| `palette_groups` | `group_palette_rows`, `matching_page_indices`, `command_match_indices`, `palette_mode_for` | `groupPaletteRows`, `matchingPageIndices`, `commandMatchIndices`, `paletteModeFor` | `apps/web/src/components/jump-to-palette.tsx` |
| `palette_sort` | `sort_hit_order`, `is_preview_key` | `sortHitOrder`, `isPreviewKey` | `apps/web/src/components/jump-to-palette.tsx` |
| `rail_group_text` | `rail_group_text` | `railGroupText` | `apps/web/src/features/settings/ui/settings-screen.tsx` |
| `route_title` | `label_for_path`, `title_for_path` | `labelForPath`, `titleForPath` | `apps/web/src/app/app-shell.tsx` |
| `screen_for_path` | `screen_for_path` | `screenForPath` | `apps/web/src/lib/parts.ts` |
| `shortcut_label` | `key_label`, `shortcut_label` | `keyLabel`, `shortcutLabel` | `apps/web/src/features/editor-workspace/ui/workspace-toolbar.tsx` |

Rules:

- `nav_open_groups`: the group you are in is always open; the others keep the reader's last choice. `parse_saved` gives an empty list for missing, junk or non-array storage and drops non-string entries.
- `nav_open_groups`: `with_active` appends `active` unless it is absent, empty or already listed.
- `palette_groups`: every function returns indices into the caller's rows, so the caller keeps its own row objects.
- `palette_groups`: headings follow `PaletteGroup::ALL` order; order inside a group is kept. An empty query gives nothing for pages and every row for commands.
- `palette_groups`: `Ctrl+K` and `Ctrl+Shift+F` open search; `Ctrl+Shift+P` opens commands. Alt and bare keys open nothing.
- `palette_sort`: ties keep their ranked order (the sort is stable). Missing or unreadable dates are `None` and sort last when descending.
- `palette_sort`: digit runs compare by value, without parsing, so long runs cannot overflow. Other runs compare as locale text, ignoring case.
- `palette_sort`: Space opens the preview. In the search box Space types a space, so there it takes Shift+Space. Other modifiers are left alone.
- `rail_group_text`: the hint names only the tabs this build shows, so a Dev build never promises a tab it lacks. `integration_titles` fills the `integrations` hint.
- `rail_group_text`: the first character is uppercased, as `charAt(0).toUpperCase()` does.
- `route_title`: the longest matching path wins, so `/report/overleaf` is not named after `/report`. A detail route takes its list's name.
- `route_title`: a trailing slash is ignored; the root path stays `/`. `title_for_path` gives `Name · WeaveForge`, or the bare app name.
- `screen_for_path`: only exact list routes have a screen cache. Detail and settings routes return `None`. A query string or fragment is cut before the lookup.
- `shortcut_label`: chords are written once with Mac glyphs (`⌘⇧F`) and read `Ctrl+Shift+F` off a Mac. `mac` is passed in by the web app.
- `shortcut_label`: each leading modifier is one cap; the key after them is one cap, so `F11` stays whole. `key_label` reads `⌘` as `Ctrl` off a Mac and leaves Mac keys unchanged.
