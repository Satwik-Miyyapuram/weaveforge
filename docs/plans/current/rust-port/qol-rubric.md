# Quality-of-life review rubric

Every reviewer applies this to every diff, after correctness and security. Findings go
in an **Improvements** list, tagged `[bug]`, `[qol]` or `[better]`, with `path:line`.
They do not block a merge unless tagged `[bug]` and caused by the diff. Everything
found lands in plan.md §10.

Sources: user requests (2026-10-30/31), NN/g heuristics and response-time limits,
Laws of UX, WCAG 2.2 AA, Ink & Switch local-first ideals, and user complaints on the
Obsidian, Logseq, Zotero, Paperpile, Mendeley, Overleaf, Readwise, GoodNotes and
Notability boards. Research notes: `research-ux-frameworks.md`,
`research-domain-complaints.md` (kept in the session scratchpad, summarised here).

Priority order: P1 is checked on every diff; P2 when the diff touches that area;
P3 when there is time.

## P1. Nothing lost

1. A sync, merge, import or overwrite never drops local text silently. The losing
   version is kept and reachable from the UI, on phone too.
2. A stale write cannot overwrite a newer one. Writes send only changed fields, or
   carry a version check (see the note-edit + status bug, §10).
3. A failed save keeps what the user typed: drafts, ink strokes, half-filled fields.
4. Bulk and destructive actions have Undo (a toast that still works after moving
   away). A confirm dialog only for actions that cannot be undone, with the verb on
   the button ("Delete note") and Cancel.
5. Import and round-trip are idempotent: run twice, same count. Duplicates are
   matched by DOI, title and file path; a "not a duplicate" choice is remembered.
   Annotations keep stable ids so re-import updates instead of appending.

## P1. Automatic and live

6. Changes from outside the app (vault files edited in another editor, Zotero,
   Overleaf, another device) appear without a click. The echo filter compares
   content or mtime, not only a time window. An open, clean note reloads in
   place; a note with unsaved edits gets a keep-mine / take-theirs / merge choice,
   never an emptied file.
7. Status the user cares about is always visible: sync state (synced, syncing,
   offline, error, N pending), running AI jobs, downloads. Not only in settings.
8. Background work never blocks typing, ink, scrolling or the next action.

## P1. Sequences

9. Doing A then B works for every pair a user would chain: edit note then change
   status, import then tag, open then sync, rename then search. Look for
   read-modify-write races, stale snapshots and cached state.
10. An error can be retried from the same screen without a restart.

## P2. Feedback

11. Every action shows a response within 0.1 s; over 1 s a busy marker; over 10 s
    progress (percent if known, otherwise indeterminate) and Cancel.
12. Fast flows (approve, toggle status) feel done at once, with a pending marker
    until the server confirms.
13. Errors say what went wrong in plain words and what to do next. No "An error
    occurred", raw codes or blame. Shown next to the failing item; minor ones
    inline, not in a modal. Never colour alone.
14. Empty states say that nothing exists yet and offer one action. "No items" is
    never shown while loading.
15. Status messages (saved, synced, 12 imported) reach screen readers without
    moving focus.

## P2. Fewer clicks

16. Bulk actions exist where users act on many items: grouped AI suggestions
    accepted at once, multi-select tag or status edits with a dry-run count, then
    Undo.
16a. AI suggestions show a diff before applying; accept-all warns with a count;
    one Undo reverts the whole batch.
16b. Reading workflow: every paper has a status (to read, skimmed, read), status
    can be set in bulk, and the reading queue is a saved filter one click away.
17. Few choices per screen; AI options grouped. Frequent targets are big and close.
18. Known conventions hold: Ctrl/Cmd+Z, Esc closes, drag files in, Enter submits.
19. The app absorbs the complexity it can (sync, citation formats, file paths)
    instead of asking the user.

## P2. Reachability

20. Every command is in the menu, the command palette and (if frequent) a shortcut,
    under the same name. The palette shows the shortcut. Ctrl+/ lists shortcuts.
21. Nothing is hover-only or buried more than two levels deep. Settings for a
    feature are reachable from the feature.
22. Code that supports a feature with no UI to reach it is a finding (for example
    browsing or clearing the artifact store and model cache).
23. Every keyboard shortcut and drag action has a tap or click path, so the phone
    can reach it.

## P2. Parity

24. Desktop, web and phone use the same name, icon and result for the same action.
    A feature missing on one surface is listed, with the reason.
25. Help sits in the same place on all three.

## P2. Speed

26. Open and search are timed on a large fixture (10k papers or notes). No
    main-thread block over 100 ms. Startup does no avoidable work.
27. Ink stroke-to-screen latency has a budget; recognition and backup never touch
    the stroke path.
28. Large files stream instead of loading whole into memory; downloads resume.
28a. Idle CPU near zero after opening a large vault; indexing is incremental,
    throttled on battery, and never repeats on every launch.

## P3. Accessibility (WCAG 2.2 AA)

29. Every control works by keyboard with a visible focus ring; focus is never
    hidden by bars, toasts or the palette.
30. Targets at least 24x24 px. Text contrast 4.5:1, controls and state markers 3:1.
31. Icon-only buttons have names. Motion stops when reduced motion is on.

## P3. Interruptions and first run

34. Notifications are few, can be turned off per kind, and stay in a history the
    user can reopen. Sync failures do notify. Update checks have a setting.
35. First run reaches a useful screen in one step (open or create a vault, or
    import), with sample data or a short tour that can be skipped.

## P3. Ownership

32. Notes stay plain files in the vault. Export works offline and without an
    account, round-trips (export, re-import, diff), and lists anything skipped.
33. Disk use is bounded or visible (model cache, artifacts, logs), with a way to
    clear it.

## How reviewers report

```
Improvements
- [bug] apps/shell/src/vault_watch.rs:41 (6) external edit within 2 s of an app write is dropped as an echo. Compare hash.
- [qol] apps/shell/src/model_cache.rs:120 (11) model download shows a blank page; no progress or cancel.
- [better] (22) no UI lists or clears the artifact store.
```

The number in brackets is the rubric item. Use "none" if nothing applies.
