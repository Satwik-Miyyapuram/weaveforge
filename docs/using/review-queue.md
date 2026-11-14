---
covers:
  - apps/web/src/app/ai-review
  - apps/web/src/features/ai-assistant/ui
checked: 2026-11-14
---
# AI review queue

The review queue is where AI suggestions wait for you. Nothing in the suggestion
changes your workspace until you approve it. How the assistant makes suggestions
is in [The AI assistant](ai-assistant.md).

## How to

### Open the queue

1. Go to `/ai-review`. The page is titled **AI suggestions**.
2. The wiki screen has an **Open review queue** button. The extraction table has
   an **Open AI review →** link. Both open the same page.

### Read a suggestion

1. Each suggestion is a card. Its title is the suggestion's own title. Without one,
   it is the kind's name, such as **Paper update**, or a sentence for a paper note
   append or a paper field.
2. The card shows the time it was made. A short reason follows it, when there is one.
3. A card with evidence has two columns: **Proposed write** and **Evidence**.
   Each evidence item shows its source, the excerpt, and a link.
4. A card with no evidence shows its sources under **Sources**. A source with a
   known title shows that title. Only ids of 32 or more hex characters are shortened, to 8 characters.

### Approve a suggestion

1. Click **Approve** on the card. For a paper note it reads **Approve and append**.
   For a paper field it reads **Approve and write cell**.
2. The button reads **Applying…** while the write runs.
3. The card leaves the list when the write is done. If the write cannot be
   applied, see [Edge cases](#edge-cases).

### Reject a suggestion

1. Click **Reject** on the card. The suggestion is removed without any change.

### Approve or reject many at once

1. Use **Group by** to group the cards by **Document** or **Kind**.
2. Each group with more than one suggestion has **Reject N** and **Approve N** buttons, where N is the group size.
3. When more than one suggestion is shown, the toolbar has **Approve all** and
   **Reject all**.
4. When more than one paper note append is shown, the toolbar has
   **Approve the N that only add**. It applies only the appends.
5. A bulk action waits 5 seconds before it runs. Click **Undo** in the bar
   that appears to cancel it. The cards stay out of the list while the bar is shown.

### Edit a suggestion before approving

The review screen has no editor. You cannot change the text of a suggestion
here. Reject it, and ask the assistant again.

## Reference

### Suggestion kinds

These are the names on the cards and in the **Group by** → **Kind** headings.

| Kind | Card name |
|---|---|
| `append_paper_note` | Append to paper note |
| `create_vault_note` | Create note |
| `create_log_entry` | Create log entry |
| `paper_update` | Paper update |
| `paper_field_value` | Extraction field value |
| `reading_list_change` | Reading-list change |
| `relation` | Graph relation |
| `zotero_import` | Zotero import |
| `milestone_follow_up` | Milestone follow-up |
| `experiment_follow_up` | Experiment follow-up |
| `edit_vault_note` | Edit note |
| `append_vault_note` | Append to note |
| `report_edit` | Report section notes |
| `milestone_status` | Milestone status |
| `experiment_update` | Experiment update |
| `paper_annotation` | Paper highlight |

### Approve button labels

| Kind | Button |
|---|---|
| `append_paper_note` | Approve and append |
| `paper_field_value` | Approve and write cell |
| all others | Approve |

### Messages

| Message | When |
|---|---|
| Nothing to review | The queue is empty. The text under it: "New AI suggestions will appear here before they can change your research workspace." |
| Nothing changes until you approve it. | Shown under the page title. |
| Not applied: the target changed since this was suggested. | One approve found the target changed, or was missing. |
| N not applied: the target changed since it was suggested. | A bulk approve skipped N suggestions because their targets changed. |
| Stopped: ... N still pending. | A bulk run stopped on an error. The rest stay in the queue. |
| Approved, but the page list could not refresh. | The write worked, but the page list did not reload. |
| Created “title”. Open page → | A new vault note was created by an approve. |
| Unverified match | Evidence hint: the source may have changed since it was cited. |
| Locus not found | Evidence hint: the cited sentence is not in the excerpt. |
| Approving N… / Rejecting N… | Shown in the bar while a bulk action waits to run. |

### Limits

- A bulk action waits 5 seconds before it runs, so **Undo** can cancel it.
- Bulk actions apply only to the cards shown, not to cards hidden by a waiting **Undo**.

## Edge cases

### Empty queue

With no pending suggestions the page shows **Nothing to review**. The toolbar,
groups and bulk buttons are not shown.

### Target deleted since the suggestion

The write checks that its target still exists. If the target is gone, the
approve is not applied and the page shows "Not applied: the target changed since
this was suggested." The suggestion stays in the queue until you reject it.

### Target edited since the suggestion (stale)

A suggestion records the state it was made from. If the target has changed since,
the approve is not applied. The page shows the same "Not applied" message. Bulk
approves report a count instead: "N not applied: the target changed since it was suggested."

Evidence can also show **Unverified match** on a card. This means the source may
have changed since it was cited. Check the excerpt before you approve.

### Bulk approve

**Approve all** and **Approve N** run one suggestion at a time. A suggestion that
is not applied is skipped and counted. If a run stops on an error, the message
begins "Stopped:" and says how many are still pending.

## How it works

Suggestions come from three places. The assistant makes them through its tools.
The wiki scan queues pages for review. MCP agents send them through the `suggest_*`
tools, such as `suggest_note_create`, `suggest_log_entry` and `suggest_paper_update`.
All three end in the same pending list. This page only reads that list, and
approve and reject call the app's write code.

Source: `apps/web/src/features/ai-assistant/ui/ai-proposal-review-screen.tsx`,
`apps/web/src/features/ai-assistant/application/parts.ts`,
`apps/shell/src/local_http/mcp_suggest.rs`

## Related

- [The AI assistant](ai-assistant.md) — how suggestions are made and what the assistant may read
- [Wiki](wiki.md) — queueing pages for review from the wiki scan
- [Papers](papers.md) — the papers that paper notes and field values are written to
