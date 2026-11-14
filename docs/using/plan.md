---
covers:
  - apps/web/src/features/plan
  - crates/wf-core/src/plan
checked: 2026-11-13
---
# Plan

The plan screen lists your milestones: dated points you are steering by, such as a
submission, a review or a chapter handed over. Each milestone has a title, an optional
target date, a status, and optional dependencies and compute needs.

## How to

### Add a milestone

1. Open the Plan screen and click **New milestone**. The dialog is titled "New milestone".
2. In **Milestone**, type a title. The placeholder is "Ablation study finished". The title is required: a blank
   or spaces-only title shows "Milestone title is required."
3. Optionally fill in **Details** and **Target date**. Click **Target date** to open a
   calendar, then pick a day; the field shows it as `dd-mm-yyyy`.
4. Set **Status**. It starts as **Planned**.
5. Click **Create**. The button reads "Saving…" while the milestone is saved.

### Edit a milestone

1. On the milestone card, open the card menu and choose **Edit**.
2. Change the fields, then click **Save**. Click **Cancel** to leave the form unchanged.

### Change a milestone's status

- Tick the checkbox on the card to mark it done. The checkbox label is "Mark <title> done".
  Untick it to reopen the milestone. Reopening sets its status to **Planned**.
- Or open the card menu, choose **Status**, and pick a status.

### Add dependencies

1. In the form, under **Dependencies**, click **+ Add dependency**.
2. Choose the kind in the dropdown labelled "Dependency kind": `milestone`, `experiment`,
   `paper` or `external`.
3. For `external`, type a label in the field with the placeholder "dataset access, cluster account…".
   For the other kinds, pick the item in the dropdown that shows "pick…".
4. To remove a dependency, click **Remove** on its row.

### Add compute needs

1. In the form, under **Compute needed**, click **+ Add compute**.
2. Type the resource in the field with the placeholder "A100". Then fill in **count**,
   **hours** and **notes** if you need them.
3. To remove a row, click **Remove** on it.

### Find or share your milestones

- Type in the field labelled **Search milestones** to filter the list.
- Click **Share plan** to share the whole plan. The button has the tooltip "Share your whole plan".
- Click **Show N done** to show finished milestones, and **Hide N done** to hide them again.

### Delete a milestone

1. Open the card menu and choose **Delete milestone**.
2. The card disappears at once and a toast reads `"<title>" deleted` with an **Undo** button.
3. The delete runs when the toast closes: after 8 seconds, when you click its close button, or
   when a fourth toast pushes it out. Click **Undo** before that to keep the milestone.

On a milestone shared with you, the menu item reads **Remove from plan** instead. The toast
then reads `"<title>" removed from your plan`.

## Reference

### Milestone statuses

| Status | Shown as |
|---|---|
| `planned` | **Planned** |
| `in_progress` | **In progress** |
| `blocked` | **Blocked** |
| `done` | **Done** |

### Date rules

- The target date is stored as a calendar day, `yyyy-mm-dd`. The calendar only offers real
  days. A date that does not exist, such as `2026-02-31`, arriving another way (an import
  or an AI suggestion) is refused with "Target date must be yyyy-mm-dd."
- An empty target date means no date.
- The card shows **Due** and the formatted date.
- A milestone with a date that is not **Done** shows `in <n>d` when the date is ahead, and
  `<n>d overdue` when it has passed. Done milestones show no countdown.
- The progress line reads "on track" when no open milestone is overdue. It shows `<n> overdue`
  for overdue open milestones, and `<n> due soon` for open milestones due within two weeks.
  Done and undated milestones are ignored.

### Milestone form messages

| Message | When |
|---|---|
| Milestone title is required. | The title is empty or only spaces. |
| Target date must be yyyy-mm-dd. | The date is not a real calendar day. |
| External dependencies need a label. | An `external` dependency has no label. |
| A `<kind>` dependency needs a refId. | An internal dependency has no item picked. |
| Compute needs a resource name. | A compute row has no resource. |
| Compute count must be a positive number. | The count is zero or below. |
| Compute hours cannot be negative. | The hours are below zero. |

### Limits and empty states

- A plan with no milestones shows **No milestones yet** with a **New milestone** button.
- A search with no matches shows "No milestones match."
- **Search milestones** appears only when the plan has at least one milestone.
- The plan header reads, for example, "3 milestones · 1 done". For one milestone it reads
  "1 milestone · 0 done".
- Milestones have no start date and no sub-items. The only dates are the target dates.

### Dependencies and deletes

- A dependency points at a milestone, an experiment, a paper, or free text (`external`).
- A dependency on a deleted item shows its chip with the tooltip "<label> was deleted".

## How it works

The milestone rules are pure functions in the Rust core (`wf-core`): validation,
date checks, the status list and the plan timeline. The web app renders the results.

Source: `crates/wf-core/src/plan/`. The screen and form are in `apps/web/src/features/plan/`.

## Related

- [Dashboard](dashboard.md) — overview of your work, including the plan
- [Sharing](sharing.md) — sharing a milestone or your whole plan
- [Sync](sync.md) — how milestone changes reach your other devices
