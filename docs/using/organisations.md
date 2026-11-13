# Organisations (labs)

A lab is a shared group, usually a research group, with professors, PhD supervisors and master's students. You create a lab or join one with an invite code. Each person sees the team below them in the supervisor tree, and the whole lab on the org chart.

## How to

### Create a lab

1. On the first-run screen, pick **Create a lab**.
2. Enter a lab name. It can be up to 120 characters.
3. Choose **Create**.
4. Copy the invite codes shown. They appear once, at create time.

You see **Lab created.** with one code per invite role.

### Join a lab with an invite code

1. On the first-run screen, pick **Join with code**.
2. Enter the code in **Join code**. Dashes and case do not matter.
3. A PhD student's professor supervisor is picked automatically when the lab has exactly one professor. Otherwise, choose one in **Professor supervisor**, or the join fails with `Choose a professor supervisor for this lab.` A master's student chooses a PhD supervisor in **PhD supervisor**.
4. Choose **Join lab**.

### Get or replace an invite code

1. Open **Settings → Organization** and choose **Reveal** next to the role.
2. Choose **Regenerate** to get a new code.
3. Share the code. Codes are shown only when they are created or regenerated, so store them securely.

### Create an account for someone in your team

1. Open **Settings → Organization**, then under **People** choose **New account**.
2. Choose a **Role** below your own. A professor can create PhD and master's accounts. A PhD supervisor can create master's accounts. A master's student cannot create any.
3. Enter the **Full name** and **Email**, and a **Temporary password** of at least 8 characters.
4. Choose **Create account**. The new member is recorded as supervised by you.

### Continue without a lab

On the first-run screen, choose **Continue without an org**. You can join or create a lab later from **Settings → Organization**. Without a lab, your team view shows only you.

## Reference

| Item | Rule |
| --- | --- |
| Lab name | Required, trimmed. Up to 120 characters (counted in UTF-16 units, so some emoji count as two). |
| Invite roles | `professor`, `phd`, `masters` |
| Invite code | 9 characters, Crockford base32, shown as `XXX-XXX-XXX`. Typed with or without dashes. Case does not matter. `I` and `L` read as `1`, and `O` reads as `0`. |
| New account email | Required. |
| New account password | At least 8 characters. |
| Role order | Professor (2), then PhD supervisor (1), then master's student (0). Standalone is -1. |

Error messages, with the cause:

| Message | Cause |
| --- | --- |
| `Lab name is required.` | The name is empty after trimming. |
| `Lab name is too long.` | The name is over 120 UTF-16 units. |
| `Choose a professor supervisor for this lab.` | A PhD student joined without a professor to supervise them. |
| `Choose a PhD supervisor in this lab.` | A master's student joined without a PhD supervisor in the lab. |
| `Unknown invite type.` | The invite names a role other than professor, PhD or master's. |
| `Email is required.` | The new account has no email. |
| `Password must be at least 8 characters.` | The temporary password is too short. |
| `Unknown role: <role>` | The new account names a role that does not exist. |

## How it works

- **Membership.** Only a lab you explicitly created or joined counts as your lab. Memberships the migration filled in for older accounts do not switch you into a lab. A lab is active when it is your selected lab and you joined it or own it.
- **Who sees whom.** Your team view shows you and everyone below you in the supervisor tree, at any depth. The org chart shows the whole active lab, including supervisors above you. Without a lab you see only yourself.
- **Setup and sync.** If your memberships cannot be read, the app does not treat that as no lab, and it does not reset your role to standalone. The setup screen shows only when your profile has loaded and setup is not finished.
- **Supervisor.** Whoever creates an account becomes that account's supervisor. A supervisor value sent with the request is ignored.

The rules run in the Rust core, so the web app and any other client give the same answer.

Source: `crates/wf-core/src/org.rs` and `crates/wf-core/src/member.rs`

## Related

- [Workspaces](workspaces.md): projects and how they switch.
- [Collaborative editing](collaborative-editing.md): two people in one note.
- [Getting started](getting-started.md): first sign-in and setup.
