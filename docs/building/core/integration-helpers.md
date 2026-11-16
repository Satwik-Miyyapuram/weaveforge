# Integration and proposal helpers

Pure helpers for MCP client config, the plan desktop widget and the AI review queue. They live in `crates/wf-core`; wasm exports in `crates/wf-wasm`; TS keeps the I/O.

| Module | Rust fn | wasm export | TS caller |
| --- | --- | --- | --- |
| `mcp_client_config` | `claude_code_commands`, `gemini_install`, `codex_toml`, `mcp_servers_json`, `vscode_json` | `claudeCodeCommands`, `geminiInstall`, `codexToml`, `mcpServersJson`, `vscodeJson` | `apps/web/src/features/settings/ui/mcp-client-config.ts` |
| `proposal_created_page` | `created_page_index` | `createdPageIndex` | `apps/web/src/features/ai-assistant/ui/ai-proposal-review-screen.tsx` |
| `proposal_groups` | `group_proposals` | `groupProposals` | `apps/web/src/features/ai-assistant/application/parts.ts` |

Rules:

- `mcp_client_config`: pure, no I/O. The launch line runs the app binary as Node, so no Node install is needed. The launch line serialises as `command`, `args`, `env` in that order. Codex TOML strings use JSON escapes. The VS Code shape adds `type: "stdio"` to each server.
- `proposal_created_page`: the executor returns no id, so the page is found by trimmed title and parent. Returns the index into `pages`, or `None` when the item created no page or no page matches.
- `proposal_groups`: groups come back in the order their first proposal appears; members keep queue order. Groups hold indices into the input, not copies. By document, a resource id not in `known_ids` groups under `kind:<kind>`. With no `known_ids`, each resource id keeps its own group.
