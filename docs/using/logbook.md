---
covers:
  - apps/web/src/features/logbook
  - crates/wf-core/src/logbook
checked: 2026-11-13
---
# Logbook

The logbook is your daily log. Each entry is a short note on what you did and
what it told you. Entries are listed by day, newest first, with a calendar and
a count per kind beside the list.

## How to

### Add an entry

1. Open **Logbook** and click **New entry**. The dialog is titled "New entry".
2. Type in the field labelled **What did you do?**. It starts with the
   placeholder "Today I… (markdown supported)".
3. Choose a kind in the **Kind** dropdown. It starts as **Daily**.
4. Click **Create**. The button reads "Creating…" while the entry is saved.
5. The new entry goes on today's day in the timeline.

### Draft an entry from today's reading

1. In the **New entry** dialog, click **Draft from today's reading**.
2. WeaveForge adds a draft of the reader marks you made today below your text.
   Nothing is saved until you click **Create**.
3. If you made no reader marks today, the message "No reading recorded today"
   appears and the text is not changed.

### Edit an entry

1. Open the menu on the entry card and choose **Edit**.
2. Change the text in the **Edit entry** editor, or change the **Kind** dropdown.
3. Click **Done**. The button reads "Saving…" while the change is saved.
4. Click **Cancel** to leave without the Kind change. Text changes made in the
   editor are already saved as you type.

### Delete an entry

1. Open the menu on the entry card and choose **Delete log entry**.
2. The entry disappears at once. A toast reads "Log entry deleted" with **Undo**.
3. Click **Undo** in the toast to keep the entry. The entry is removed when the
   toast closes.

### Find an entry

1. Type in the **Search the log** box at the top of the screen.
2. To show one kind only, click its row under **Kinds**. Click the row again to
   show all kinds.
3. If nothing matches, the screen says "No entries match." Use the clear
   control there to reset the search and the kind filter.

### Jump to a day

Click a logged day in the calendar. The timeline scrolls to that day and
highlights it for a moment. Use **Previous month** and **Next month** to move
between months.

### Send a check-in to your supervisor

1. Click **Send check-in** at the top of the screen. The dialog is titled "Send check-in".
2. Type a **Title**, for example "Week 12 check-in". It is required.
3. Optionally, type a **Note to supervisor (optional)**.
4. Click **Send check-in**. The button reads "Sending…" while it is sent.
5. The check-in is listed under **Past check-ins**.

## Reference

### Entry kinds

| Kind | Meaning | Shown as |
|---|---|---|
| Daily | One entry per day (the default) | **Daily** |
| Weekly | One entry per week | **Weekly** |

### Limits and required fields

- **What did you do?** must not be blank. **Create** stays disabled until
  there is text.
- The **Title** of a check-in is required. **Send check-in** stays disabled
  until it has text.
- Blank text is refused by the core with "Log entry body is required."

### Messages

| Where | Text |
|---|---|
| Delete toast | Log entry deleted |
| Draft from today's reading | No reading recorded today |
| Search with no match | No entries match. |
| Past check-ins, offline or signed out | Past check-ins show when you are online. |
| Past check-ins, none sent | No check-ins sent yet. |

### Dates

- An entry's date is the day it is created. The form has no date field, so you
  cannot file an entry under a past or future day.
- Editing an entry changes its text and kind only. Its date does not change.
- The first line of the text is the card title. If the first line has no text
  once heading marks are removed, the card shows "Untitled entry".
- The calendar and the "today" marker use your local calendar day.
- The clock time on each card is shown in your local time.

## How it works

The screen is in `apps/web/src/features/logbook/`. The rules for kinds, the
streak and the day grouping are in the Rust core (`crates/wf-core/src/logbook/`).
Entries are saved to the project, and each save is also pushed to git. A failed
git push or chat post is written to the app log and does not undo the save.

## Related

- [Papers](papers.md) — the papers you read and mark
- [Reader](reader.md) — the reader marks that **Draft from today's reading** uses
- [Sharing](sharing.md) — who can see what you send
- [Search](search.md) — finding notes and entries across the project
