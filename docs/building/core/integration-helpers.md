# Integration and proposal helpers

Pure helpers for the Zotero bridge, MCP client config, the plan desktop widget and the AI review queue. They live in `crates/wf-core`; wasm exports in `crates/wf-wasm`; TS keeps the I/O.

| Module | Rust fn | wasm export | TS caller |
| --- | --- | --- | --- |
| `zotero_local_url` | `is_local_zotero_url` | `isLocalZoteroUrl` | — |
| `mcp_client_config` | `claude_code_commands`, `gemini_install`, `codex_toml`, `mcp_servers_json`, `vscode_json` | `claudeCodeCommands`, `geminiInstall`, `codexToml`, `mcpServersJson`, `vscodeJson` | `apps/web/src/features/settings/ui/mcp-client-config.ts` |
| `plan_widget` | `clean_widget_palette`, `parse_bounds`, `place_widget`, `parse_taskbar_created` | `cleanWidgetPalette`, `parsePlanWidgetBounds`, `placePlanWidget`, `parseTaskbarCreatedId` | — |
| `proposal_created_page` | `created_page_index` | `createdPageIndex` | `apps/web/src/features/ai-assistant/ui/ai-proposal-review-screen.tsx` |
| `proposal_groups` | `group_proposals` | `groupProposals` | `apps/web/src/features/ai-assistant/application/parts.ts` |

Rules:

- `zotero_local_url`: true only for the local Zotero origin (`LOCAL_ORIGIN`) on `/api` or below, with no credentials. Anything that does not parse is refused.
- `mcp_client_config`: pure, no I/O. The launch line runs the app binary as Node, so no Node install is needed. The launch line serialises as `command`, `args`, `env` in that order. Codex TOML strings use JSON escapes. The VS Code shape adds `type: "stdio"` to each server.
- `plan_widget`: fixed size 320 by 432 logical px. A palette needs every key in `WIDGET_PALETTE_KEYS` as a `#rrggbb` colour, lowercased on output; any bad value gives `None`. A saved position keeps only `x` and `y`, rounded half up like `Math.round`. A spot outside every work area falls back to the top-right corner of the first screen. With no screens, the fallback work area is used. The `TaskbarCreated` id is read as a decimal integer and must be in `0xC000` to `0xFFFF`.
- `proposal_created_page`: the executor returns no id, so the page is found by trimmed title and parent. Returns the index into `pages`, or `None` when the item created no page or no page matches.
- `proposal_groups`: groups come back in the order their first proposal appears; members keep queue order. Groups hold indices into the input, not copies. By document, a resource id not in `known_ids` groups under `kind:<kind>`. With no `known_ids`, each resource id keeps its own group.
