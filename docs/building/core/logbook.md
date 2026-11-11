# Logbook core module

The `logbook` module holds the pure helpers behind the logbook: how a log
entry is created and checked, how entries map to and from database rows, how
the screen groups and labels them, and how a long entry is shortened for the
citation alert. It does not store entries or read the clock.

## What lives in Rust

Source: `crates/wf-core/src/logbook/`

- `log_entry.rs`: builds a new log entry and checks its input.
- `log_entry_row.rs`: maps a log entry to and from its row in the `log_entries` table.
- `log_view.rs`: groups entries by day, counts the streak and builds the eyebrow text. `today` is passed as `yyyy-mm-dd`.
- `collapse_alert.rs`: shortens a citation alert (DA-110) to its short form.

`mod.rs` describes the module as the pure helpers behind the logbook.

## How the app calls it

The wasm exports live in `crates/wf-wasm/src` (`log_entry.rs`,
`logbook_view.rs`, `logbook_collapse_alert.rs`). The
TypeScript wrappers in `packages/wf-wasm/src` import the raw names from
`../pkg/wf_wasm.js` and re-export them. The main names are:

- Entry (`log-entry.ts`): `createLogEntry`, `logEntryInputError`, `LOG_KINDS`
  (`daily`, `weekly`).
- Rows: no export. The `log_entries` repository runs in Rust
  (`repos/log_entries.rs`, see [data-access](data-access.md)) and maps rows there.
- View (`logbook-view.ts`): `groupByDay`, `streakDays`, `logEyebrow`,
  `splitHeadline`, `newestFirstOrder`.
- Alert (`logbook-collapse-alert.ts`): `collapseAlert`.

Code in `apps/web` reads these through `readyCore()` or `typedCore()` from
`apps/web/src/lib/rust-core.ts`, or through the wrappers in `packages/wf-wasm`.
`readyCore()` throws until `loadCore()` has resolved, so call it only after
the core has loaded.

## What stays in TypeScript, and why

- **Storage and use cases.** Saving and loading entries through PostgREST,
  and the use cases that call them, stay in TypeScript. Rust maps rows; it
  does not talk to the server.
- **The caller's id and clock.** `createLogEntry` takes the new id and the
  current time as arguments. The caller makes them, so Rust stays
  deterministic in tests.
- **Hooks and components.** The logbook screen, the past check-ins list and
  the alert UI stay in `apps/web/src/features/logbook`.
- **Type contracts.** The TypeScript types for entries and rows stay in
  `packages/core` and `packages/wf-wasm/src`, because the app type-checks
  against them.

## Related

- [AI core](ai.md)
- [Dashboard core](dashboard.md)
- [Plan core](plan.md)
- [Settings core](settings.md)

Source: `crates/wf-core/src/logbook/`
