---
covers:
  - apps/web/src/app/supervision
checked: 2026-11-13
---
# Supervision

The Supervision screen shows a supervisor the work of the students below them in the lab. You see their milestones and logbook, live or as a check-in they sent. Setting up the lab is covered in [Organisations](organisations.md).

## How to

### See your students

1. Open **Supervision** in the sidebar. It is shown to professors and PhD supervisors.
2. The heading reads **Supervision**. Under it, the line reads "You supervise N people" (or "1 person").
3. The **Your team** list shows everyone below you, at any depth. Each row has the person's name and role.
4. Choose a name to open their panel. The first student in the list opens by default.

### Read a student's check-ins

1. Open a student's panel. The **Check-ins (N)** card lists the check-ins they sent.
2. Pick one in the **Reviewing** dropdown. Each entry shows the check-in title and the date it was sent.
3. A note from the student, if any, appears under the dropdown. It is headed "Note from" and their first name.
4. The **Milestones**, **Logbook** and any experiment or report cards then show what the student sent. Their badge reads **Snapshot**.
5. With no check-ins, the cards show the student's current data. Their badge reads **Live**.

### Send a check-in as a student

1. Open **Logbook** and choose **Send check-in**. The dialog is titled "Send check-in".
2. Enter a **Title**. The placeholder is "Week 12 check-in". The button stays off until the title is not empty.
3. Optionally write a **Note to supervisor (optional)**.
4. Choose **Send check-in**. The button reads "Sending…" while it sends.
5. The check-in freezes your current milestones and log entries. It does not change after you send it.

## Reference

### Who sees Supervision

| Your role | What you see |
| --- | --- |
| Professor | **Your team** with all students below you. |
| PhD supervisor | **Your team** with the master's students below you. |
| Master's student | "You don’t supervise anyone." No team list. |

### What a supervisor sees

| Card | Heading | Empty state |
| --- | --- | --- |
| Check-ins | `Check-ins (N)` | "No check-ins yet. Live plan and logbook are shown below until they send one." |
| Milestones | `Milestones (N)` | "No milestones yet." |
| Logbook | `Logbook (N)` | "No log entries yet." |
| Experiments | `Experiments (N)` | "No experiments yet." Shown only for a check-in that has experiments. |
| Report progress | `Report progress (N)` | "No report sections yet." Shown only for a check-in that has a report. |

Each milestone shows **Target date** when it has one.

### Edge cases

| Situation | What happens |
| --- | --- |
| Professor or PhD supervisor with no students | The team list is empty. The screen shows **No students yet**, "Ask your org admin to assign students to you.", and an **Open sharing** button. The header reads "You supervise 0 people". |
| Master's student, or no profile loaded yet | The screen shows only "You don’t supervise anyone." |
| Profile cannot load | The screen shows "Could not load your profile:" and the error. |
| Student's data cannot load | The panel shows the error in place of its cards. |
| Offline | In **Logbook**, **Past check-ins** shows "Past check-ins show when you are online." when it cannot load. |
| Student leaves the lab | They drop out of your **Your team** list, because the team is read from the lab's current members. A check-in they already sent does not change. |
| You own the lab | **Leave** is not offered. Only members who do not own the lab see it. |

### Messages

| Text | Where |
| --- | --- |
| "Loading supervision…" | While the screen loads. |
| "Leave lab?" | Confirmation before you leave a lab. Button: **Leave lab**. |
| "Sending…" | While a check-in is sent. |

## How it works

- **Team view.** Your team is the people below you in the supervisor tree, at any depth. The rule is `students_of` in `crates/wf-core/src/member.rs`.
- **Check-ins.** A check-in is a frozen copy of the project's milestones, logbook, experiments and report sections. It is stored in the `lab_snapshots` table, read and written by the org feature.
- **Leaving.** When you leave your active lab, the relay moves your profile to your newest remaining lab, or to standalone if you have none. See `apps/relay/server/src/org_members.rs`.

Source: `apps/web/src/features/org/ui/supervision-screen.tsx`, `apps/web/src/features/org/infrastructure/parts.ts`, `apps/web/src/features/logbook/ui/logbook-screen.tsx`

## Related

- [Organisations](organisations.md): creating and joining a lab, invite codes, roles.
