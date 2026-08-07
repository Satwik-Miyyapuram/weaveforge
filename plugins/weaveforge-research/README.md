# WeaveForge Research Codex plugin

This plugin gives Codex an explicitly authorised, end-to-end encrypted path to
selected WeaveForge sources. It works only while an unlocked WeaveForge
browser has an active access session. It does not receive PDFs, encryption keys,
Zotero credentials, database credentials, account settings, or anything outside
that session's selected sources.

## Connect an active workspace

1. In WeaveForge, open **Settings → AI assistant access** and enable it.
2. Allow the read categories you need, then create an **MCP token**. Copy it at
   creation time; it is shown only once and can later be revoked in the same
   panel.
3. Select sources, choose an access duration (15 minutes to one week), and
   choose **Start access**.
4. Copy the session ID and pairing secret shown for that live connection. Keep
   the browser page open and encryption unlocked.
5. Configure the plugin process with these environment variables:

```text
WEAVEFORGE_MCP_URL=https://your-weaveforge.example.com
WEAVEFORGE_MCP_TOKEN=tt_...
WEAVEFORGE_MCP_SESSION=<session ID from WeaveForge>
WEAVEFORGE_MCP_PAIRING_SECRET=<pairing secret from WeaveForge>
```

The MCP token is reusable until you revoke it. The session ID and pairing
secret belong to the current browser approval; start a fresh access session when
it expires or the browser locks. The remembered pairing-secret option stores
only that secret in your WeaveForge settings.

## What Codex can do

- Search the selected metadata, paper notes, synced Zotero annotations/notes,
  reading lists, vault notes, logbook, and experiment/milestone sources.
- Retrieve bounded excerpts and an outline of the currently allowed workspace.
- Never access paper PDFs, attachments, API keys, account settings, report
  contents, or unselected resources.

Every access request is encrypted between this local plugin process and the
unlocked browser. The web relay stores opaque envelopes only. Revoking a
session, disabling AI access, locking encryption, or revoking the MCP token
stops further access.

## Installation and updates

The repository marketplace entry is at `.agents/plugins/marketplace.json`.
Install `weaveforge-research` from that marketplace, then start a new Codex
thread. After an update, reinstall or refresh the plugin so Codex picks up the
new cache-busted version before testing a connection.
