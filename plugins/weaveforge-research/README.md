# WeaveForge Research plugin

Connects AI clients to a WeaveForge workspace on the same computer. Includes
the `weaveforge` MCP server (a small stdio bridge) and the
`weaveforge-research` skill.

- **Local only.** The bridge talks to the WeaveForge desktop app at
  `127.0.0.1:27123`. Nothing goes through a WeaveForge server.
- **Read and search** notes, papers (with PDF text), reading lists,
  experiments, milestones, the logbook and the report.
- **Drafts only.** Every write is a draft that waits for your approval in
  WeaveForge.
- **Experiment tracking.** `experiment_tracking_setup` tells the agent how to
  install and use the `weaveforge` Python SDK in the code it writes, without
  ever showing it the token.

## Set up

1. Open WeaveForge, go to **Settings → AI & MCP** and press **Connect**. This
   creates one "AI clients" token and saves it to `~/.weaveforge/mcp.json`
   (readable only by you). **Disconnect** revokes it.
2. Add WeaveForge to your client. The **Add to a client** tabs under Connect
   show the exact steps for this computer; the short version:

| Client | How |
| --- | --- |
| Claude Code | `claude plugin marketplace add Satwik-Miyyapuram/weaveforge`, then `claude plugin install weaveforge-research@weaveforge` |
| Claude Desktop | **Add to Claude Desktop** in Settings opens its extension installer |
| Gemini CLI | `gemini extensions install https://github.com/Satwik-Miyyapuram/weaveforge` |
| Codex | Paste the TOML from Settings into `~/.codex/config.toml`, or install this plugin from the repo's Codex marketplace |
| Cursor, VS Code | **Add to Cursor** / **Add to VS Code** in Settings opens the editor's own confirm dialog |
| Others | Copy the `mcpServers` JSON from Settings (Windsurf, Cline, Zed, opencode, Goose, LM Studio…) |

The Claude Code plugin and the Gemini extension run the bridge with `node`, so
they need Node.js 18 or newer on `PATH`. The lines Settings gives you run the
bridge with the WeaveForge app itself and need no Node install.

## How the bridge finds the app

On every request the bridge reads `{ url, token }` from `~/.weaveforge/mcp.json`
(or the file in `WEAVEFORGE_MCP_FILE`). `WEAVEFORGE_MCP_URL` and
`WEAVEFORGE_TOKEN` override them. It only talks to loopback addresses. When
the app is closed it still lists the tools and answers each call with a note
to open WeaveForge.

## License

AGPL-3.0-only. See [LICENSE](LICENSE).
