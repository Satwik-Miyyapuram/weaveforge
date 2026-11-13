# Git

The Git screen lists the branches and recent commits of the repository your
project lives in. You can track a commit or a whole branch as an experiment, so
the code behind a result stays one click away. The screen only reads: it never
writes to the repository.

This is not the folder history. To commit your workspace folder after each
write, see [The workspace folder](workspace-folder.md#keeping-a-history).

## How to

### Connect a repository

1. Open **Settings**, then find the **Connections** section.
2. Click **GitHub — Git tab** or **GitLab — Git tab**.
3. In the dialog, turn on **Enabled**.
4. Fill in **Token**, **Repo** and **Branch**. The placeholders show the expected form.
   - GitHub: **Repo** is `owner/repo`. The token needs the repo scope.
   - GitLab: **Repo** is `group/project` or the numeric id. The token needs the api scope.
   - **Branch** is the branch the screen opens on. It defaults to `main`.
5. Click **Save connection**. The button reads "Saving…" while it saves.

### Read the commits on a branch

1. Open **Git** from the navigation. The item shows only once a GitHub or
   GitLab Git tab connection is set up for this install.
2. The repository link and **Connected** show at the top, with the branch you track.
3. The **Commits** list shows the latest commits of the tracked branch.
4. To look at another branch, click its name in the **Branches** list. The branch
   marked **default** is your tracked branch.
5. To find a commit, type in the search box labelled **Search commits**. It matches the
   message, the author and the short sha.
6. Click **Sync now** to read the repository again.

### Track a commit or a branch as an experiment

1. In the **Commits** list, click **Track** on the commit. The commit's message becomes
   the experiment name. A confirmation line reads `Tracked “<message>” as an experiment.`
2. To track the whole branch, click **Track <branch> as experiment** in the
   **Branches** panel. The button reads "Tracking…" while it runs.
3. A tracked branch shows up as an experiment, with its runs.

## Reference

### States

| What you see | Meaning |
|---|---|
| **No repository connected** (with **Open settings**) | No GitHub or GitLab connection is enabled, or the token or repo is empty. |
| **Connected** | The repository is enabled, with a token and a repo. |
| **Loading git history…** | The first read is running. |
| **Refreshing git history…** | A branch change or **Sync now** is running. |
| **Syncing…** | **Sync now** is running. The button is disabled. |
| **default** | The branch matches the **Branch** field in Settings. |

### Messages

| Message | Cause |
|---|---|
| Connect this provider in Settings first. | The token or the repo is empty. |
| Git read failed (`<status>`). `<response text>` | The provider refused the read. The status is the HTTP code and the response text follows it. |
| `Tracked “<message>” as an experiment.` | A commit was tracked. |
| `Tracked branch “<branch>” as an experiment.` | A branch was tracked. This line appears in the same place as errors. |

### Limits

- The branch list shows up to 100 branches.
- The commit list shows the latest 30 commits of the chosen branch.
- Only the first enabled connection is read. GitHub is checked before GitLab.
- A connection needs a token and a repo. Without both, the screen shows
  **No repository connected**.

## How it works

The screen calls the provider's REST API from the browser. It sends your token
with each request. The token is kept with the project, in the same place as the
other connection settings.

The URL for each read and the error for a missing connection come from the Rust
core (`wf-core`). Each read is `git_read_plan`, and a failed read is
`git_read_failure_message`.

Source: `apps/web/src/features/sync/ui/git-screen.tsx`, `apps/web/src/features/sync/infrastructure/parts.ts`,
`crates/wf-core/src/sync/git_api.rs`

## Related

- [Sync](sync.md) — how your work reaches your account
- [The workspace folder](workspace-folder.md) — committing your folder to git
- [Integrations](integrations.md) — other connected services
