---
covers:
  - apps/web/src/features/sharing
  - crates/wf-core/src/sharing.rs
checked: 2026-11-13
---
# Sharing

Share a paper, experiment, reading list, milestone, report section or vault
page with one member of your organisation, and choose what they can do with it:
look, comment, or edit together.

## How to

1. Open the item and choose **Share**.
2. Pick the member to share with.
3. Pick the access level: **Can view** is read only, **Can comment** adds the
   right to leave comments, and **Can edit** lets you both edit together.

Can edit is only offered for a single vault page or report section. Every other
type can be shared for viewing or commenting.

A share can also cover every item of a type at once. A blanket share, with no
specific item chosen, gives the member the access level you pick (view or
comment) to every item of that type that you own. A blanket share cannot be set
to Can edit.

Comments are left on a paper, a passage, or a page. A reply belongs to its
thread, and a comment needs text before it can be posted.

### See what others shared with you

Go to `/shared` to see items other people shared with you. The heading is
**Shared with you**. Items are grouped by the person who shared them.

Each item shows an access tag, **Can comment** or **Can view**. Select **Open**
to read it. A paper shows **Open note** instead.

If more than one type is shared, **Filter by type** appears. Pick **All** or one
type.

To share your own items in bulk, choose **Share my work**. It offers **All notes**,
**All papers**, **All experiments**, **Whole report**, **Whole plan** and **All
reading lists**.

## Reference

Shareable types: milestone, experiment, report section, reading list, paper and
vault page.

Access levels, from least to most: `view`, `comment`, `edit`. A grant with no
access level becomes `comment`.

Rules the app enforces:

- A grant for a single item needs that item's type and owner to match.
- A blanket grant covers every item of its type from the same owner.
- Commenting needs `comment` or `edit`. Editing needs `edit`.
- Edit access is refused on any type other than a single vault page or report
  section, and on a blanket grant.
- A recipient is required on every grant.
- A comment body is trimmed and must not be blank. A comment needs a target.
- A reply, or a comment with a blank quote, drops the passage it would have
  anchored to.

The `/shared` screen shows **Loading shared items…** while it loads. With nothing
shared, it shows **Nothing shared with you yet** and this text: "When someone
shares a paper, a note or a reading list with you, it lands here grouped by who
sent it. You can comment on what they share; the edits stay theirs." A
**Go to your papers** button is shown too. A load failure shows the error text.

The `/shared` screen has no **Remove** button. The owner removes a share in that
item's share dialog, with **Remove** beside the person. When nobody is left, the
dialog shows "Not shared with anyone yet."

## How it works

The rules are pure functions in Rust. The web app calls the same functions
through the WebAssembly build, so the share dialog, the shared-with-me list and
the library's duplicate-shared-vault flow all agree on who can do what.

Source: `crates/wf-core/src/sharing.rs`

## Related

- [Collaborative editing](collaborative-editing.md) — what happens when two people edit at once
- [Organisations](organisations.md) — who the members are
- [Workspaces](workspaces.md) — where shared items live