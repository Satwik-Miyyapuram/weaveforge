---
covers:
  - crates/wf-core/src/integrations
  - crates/wf-core/src/zotero.rs
  - apps/web/src/integrations
checked: 2026-11-14
---
# Integrations

WeaveForge connects with your existing research tools — reference managers,
code repositories, writing platforms, lab messaging, citation catalogs, and
AI assistants.

Credentials and connections in WeaveForge belong to two distinct scopes:

- **Personal credentials** (**Settings → Integrations**): Your individual API keys
  (e.g., Zotero API key, Semantic Scholar key). These are associated with your user
  account and shared across all your projects.
- **Project connectors** (**Settings → Integrations**): Repository links, Overleaf
  sync, and notification channels tied to the active project. Switching projects
  automatically switches the active connectors.

---

## 1. Zotero

WeaveForge integrates with Zotero in two ways: via cloud API sync (available in both
the browser and desktop) and direct local loopback to Zotero 7 (desktop only).

### Cloud Sync (Browser & Desktop)

1. **Obtain your credentials**:
   - Log into [zotero.org/settings/keys](https://www.zotero.org/settings/keys).
   - Click **Create new private key**. Give it a label (e.g. `WeaveForge`), check
     **Allow library access**, and click **Save Key**.
   - Note your **API Key** (shown once) and your numeric **User ID** (displayed at
     the top of the API keys page: *"Your userID for use in API calls is 1234567"*).
2. **Configure in WeaveForge**:
   - Go to **Settings → Integrations**.
   - Under **Zotero**, enter your **API key** and **Library** (`users/<id>` or `groups/<id>`), then click **Save**.
3. **Select a Collection (Optional)**:
   - In **Settings → Integrations**, choose which Zotero collection to mirror for the
     current project, or leave it blank to sync your entire library.
4. **Syncing your library**:
   - In the **Papers** screen, open the **Add paper** menu and click **Sync Zotero**.
   - Items in your collection are imported into your library with metadata, DOIs,
     arXiv IDs, and PDF attachments.
   - Highlights and notes made in Zotero's PDF reader are pulled in as read-only
     annotations on the paper.

### Local Zotero on Desktop (No Account / Key Needed)

If you have Zotero 7 running on the same PC or Mac, WeaveForge Desktop can read from
it directly without needing an API key:

- Open the **Papers** screen.
- Click **More → Read Zotero on this computer**.
- WeaveForge connects to Zotero's local loopback API (`http://127.0.0.1:23119`)
  through the desktop shell.
- Your local papers and annotations are imported instantly without needing an
  Internet connection or an API key.

### Two-Way Annotation Write-Back

When an API key is configured, annotations and notes created in WeaveForge's PDF reader
can write back to your Zotero cloud library, keeping both libraries synchronized.

---

## 2. GitHub & GitLab

Connect code repositories to your thesis or research project to browse source
trees and inspect commits.

### Setting Up Authentication

1. **Generate an access token**:
   - **GitHub**: Go to **GitHub Settings → Developer settings → Personal access tokens**.
     Create a token with `repo` scope (or fine-grained with read access to your repository).
   - **GitLab**: Go to **GitLab Preferences → Access Tokens**. Create a token with
     `api` scope.
2. **Connect your project**:
   - Open **Settings → Integrations** in WeaveForge.
   - Under **GitHub** or **GitLab**, paste your **Token**.
   - Specify the repository path (`owner/repository`, e.g. `octocat/thesis-experiments`).
   - Specify the default branch (`main` or `master`), then save.

### Using the Git Tab

Once connected, the **Git** item appears in the main navigation bar:

- **Branch switching**: Inspect any branch in the repository without leaving WeaveForge.
- **Commit history**: Browse chronological commits with authors, timestamps, and commit messages.
- **Diff viewer**: Click any commit to view changed files and side-by-side or inline diffs.

---

## 3. Overleaf & LaTeX

WeaveForge bridges Markdown research notes with formal LaTeX manuscripts in Overleaf.

### Connecting Overleaf

1. In **Settings → Integrations** (or in **Report → Overleaf**), provide your **Overleaf Git token**
   (found in Overleaf under **Menu → Git**) and **Overleaf project ID**.
2. WeaveForge clones the project via the Overleaf Git bridge (or through this computer's
   keychain in desktop offline mode).

### Two-Way Sync

- **Drafting in WeaveForge**: Write sections in Markdown using the distraction-free
  editor. WeaveForge compiles your Markdown into `.tex` sections and commits them
  directly into the Overleaf project repository.
- **Wikilink to `\cite` Resolution**: Any `[[Paper Title]]` reference in your text
  is automatically resolved into `\cite{citeKey}` in the generated LaTeX.
- **Automatic `.bib` Generation**: WeaveForge gathers all cited papers across your
  report and generates a synchronized `.bib` file for your Overleaf compiler.

For full details on excerpts, citation keys, and Overleaf sync, see
[`citations-and-overleaf.md`](citations-and-overleaf.md).

---

## 4. Mattermost (Team & Deadline Notifications)

Post updates, deadline alerts, and experiment notifications to your lab or personal
Mattermost channels.

### Configuration

1. In Mattermost, create a bot account (**Integrations → Bot Accounts**) and copy its
   access token. Add the bot to the channel it should post in.
2. Copy that channel's ID (channel menu → **View Info**).
3. In WeaveForge, open the project's connections, choose **Mattermost — project alerts**,
   and fill in **Bot token**, **Server URL** (e.g. `https://mattermost.example.com`) and
   **Default channel ID**.

### Automated Notifications

Each event posts only if you switch it on for the project, and each can go to its own
channel (otherwise the default channel):

- **Milestones**: a milestone is added, or its status changes.
- **Citation alerts**: new papers cite a paper you track.
- **Daily and weekly logs**: a log entry is saved.

Milestone deadlines are not posted. For deadline reminders, use the Plan calendar feed,
which can remind you 1 day, 3 days, or 1 week before a due date.

---

## 5. Semantic Scholar

Enrich your literature library with automated citation graphs and paper recommendations.

### Configuration

- Open **Settings → Integrations**.
- Under **Semantic Scholar & OpenAlex**, optionally enter your **API key** or **OpenAlex API key**. (An API key is not required
  for basic lookups, but provides higher rate limits for large libraries).

### Features

- **Automated Citation Graph**: In the **Graph** view, WeaveForge uses Semantic Scholar's
  citation graph API to discover papers citing each other within your library and draws
  directional citation edges.
- **Find Related Papers**: Open any paper in your library and click **Find related papers**.
  Semantic Scholar evaluates the paper's embedding and reference list to recommend 5–10
  highly relevant preprints and publications, which you can add to your reading lists in one click.

---

## 6. AI Assistant & MCP (Model Context Protocol)

WeaveForge exposes an MCP server (`plugins/weaveforge-research`) so external AI agents
(such as Claude Desktop, Cursor, or Gemini CLI) can explore your research workspace and
propose edits safely.

### Connecting Claude Desktop or Cursor

Add the WeaveForge MCP server to your AI client's configuration file (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "weaveforge": {
      "command": "node",
      "args": ["<path-to-weaveforge>/plugins/weaveforge-research/dist/index.js"]
    }
  }
}
```

### Available MCP Tools

- **Read-only tools**:
  - `search_workspace`: Search notes, papers, logs, and experiments.
  - `get_source_excerpt`: Retrieve specific quotes and annotations from a paper.
  - `get_workspace_outline`: Inspect your current report structure and plan milestones.
- **Proposal tools**:
  - `suggest_append_paper_note`: Suggest a note to add to a paper.
  - `suggest_create_vault_note`: Propose a new vault note.
  - `suggest_create_log_entry`: Propose a logbook entry.
  - `suggest_paper_update`: Propose a change to a paper's details.
  - `suggest_paper_field_value`: Propose a value for one paper field.
  - `suggest_reading_list_change`: Propose adding a paper to a reading list.
  - `suggest_relation`: Propose a link between two papers.
  - `suggest_zotero_import`: Propose importing a paper from Zotero.
  - `suggest_milestone_follow_up`: Propose follow-up tasks for a milestone.
  - `suggest_experiment_follow_up`: Propose follow-up tasks for an experiment.

### Human-in-the-Loop Review (`/ai-review`)

AI assistants cannot write directly to your database. Any modification suggested by an
AI assistant is saved as a proposal in **`/ai-review`**. Nothing changes until you
click **Approve** or **Reject**. Some proposals show **Approve and append** or
**Approve and write cell** instead of **Approve**. See
[`../building/mcp.md`](../building/mcp.md) for tool specifications.

---

## 7. Web Browser Capture & Paper Import

Capture papers directly into WeaveForge while browsing arXiv, PubMed, IEEE Xplore,
or university portals:

- **Direct Import by URL or DOI**: In the WeaveForge **Papers** screen, click
  **Add paper** and paste any arXiv URL/ID, DOI, Semantic Scholar URL, or direct
  PDF link. WeaveForge's metadata resolver automatically queries arXiv, Crossref,
  and Semantic Scholar to extract the title, authors, venue, and abstract, and
  fetches the PDF into your project library.
- **Via Zotero Connector**: If you use the Zotero browser extension, saving a paper
  into your synchronized Zotero collection brings it into WeaveForge with all
  annotations and PDF attachments on your next sync.

---

## Developer Architecture & Adding Providers

WeaveForge wires third-party services through a **plugin-style integration layer** at
the composition root. Feature code and UI depend on **ports** (interfaces in `@weaveforge/core`)
and **facades** — never on concrete SDKs directly.

### Ports and Integration Kinds

| Kind | Core port | Wire function | Credential scope | Env variable |
|------|-----------|---------------|------------------|--------------|
| **Bibliography** | `IBibliographyIntegration` | `wireIntegrations()` | User + project collection | `NEXT_PUBLIC_BIBLIOGRAPHY_PROVIDER` |
| **Citation** | `ICitationSource` | `wireCitationSources()` | User (optional key) | `NEXT_PUBLIC_CITATION_PROVIDER` |
| **Notification** | `INotificationIntegration` | `wireIntegrations()` | Project connector | `NEXT_PUBLIC_NOTIFICATION_PROVIDER` |
| **Log sync** | `ILogSyncIntegration` | `wireIntegrations()` | Project connector | `NEXT_PUBLIC_LOG_SYNC_PROVIDER` |
| **Git read** | `IGitClient` | `wireIntegrations()` | Project connector | `NEXT_PUBLIC_GIT_READ_PROVIDERS` |

### Deployment Configuration (`.env.local`)

```ini
NEXT_PUBLIC_BIBLIOGRAPHY_PROVIDER=zotero          # zotero | none
NEXT_PUBLIC_NOTIFICATION_PROVIDER=mattermost      # mattermost | none
NEXT_PUBLIC_LOG_SYNC_PROVIDER=gitlab              # gitlab | none
NEXT_PUBLIC_CITATION_PROVIDER=semantic-scholar    # semantic-scholar | none
NEXT_PUBLIC_GIT_READ_PROVIDERS=github,gitlab      # comma-separated | none
```

- Set a provider to `none` to disable that port (noop adapter + hidden Settings rows).
- User and project tokens are **never** in environment variables; they are stored in the
  database (or local keychain) with RLS isolation.

For comprehensive instructions on writing new adapters, manifests, and contract tests,
see [`extensions.md`](extensions.md).
