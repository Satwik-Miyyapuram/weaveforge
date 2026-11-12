# Error-report core

The error-report core makes a report safe to send and easy to read. It removes secrets and personal data, caps the length, and builds the address and body of a prefilled "new issue" link.

## What lives in Rust

The module is `wf_core::error_report`. Its `mod.rs` says it holds "error-report helpers: making a report safe to send and keep it readable".

Each file below owns one part:

- `issue_url`: a prefilled "new issue" address, for a copy of the app that cannot file one itself. Exports `new_issue_url`, `report_markdown` and `ReportMarkdown`.
- `redact`: removes secrets and personal data from an error report before it leaves the app. Exports `redact`, `redact_and_cap` and `Redacted`.

## How the app calls it

The app reaches the core through `readyCore()` from `@/lib/rust-core`. The wasm exports live in `crates/wf-wasm/src/error_report.rs`.

The exports are:

- `maxReportChars`: the length cap.
- `redactReport`: redacts a report.
- `redactReportAndCap`: redacts and caps a report in one call.
- `newIssueUrl`: builds the prefilled new-issue address.
- `reportMarkdown`: builds the report body.

The one real call site is `apps/web/src/lib/error-report/parts.ts`. Its header says the address and body are "built in Rust (`wf_core::error_report::issue_url`)". Line 25 calls `readyCore().newIssueUrl(input.title, input.body, input.repo ?? reportRepo())`. Line 30 calls `readyCore().reportMarkdown(input)`.

No direct app call to `redactReport` or `redactReportAndCap` was found in `apps/web/src`. The redaction exports exist for the core and are ready for callers that need them.

## What stays in TypeScript, and why

The log capture wrappers stay in TypeScript. These files hold live app state that only exists in the browser:

- `apps/web/src/lib/error-report/app-log.ts` writes app log lines.
- `apps/web/src/lib/error-report/log-buffer.ts` wraps `console.error` and `console.warn` and holds the line buffer and seen-set.
- `apps/web/src/lib/error-report/request-log.ts` wraps `window.fetch`, reads the bounded body and records request history.
- `apps/web/src/lib/error-report/parts.ts` suppresses repeated warnings.

The rules are in Rust, `crates/wf-core/src/error_report/log_buffer.rs`: `is_noise` (failed-request URLs left out),
`console_line` (`[level] text`), `push_line` (trim to the newest 40 lines), `record_uncaught` (`[uncaught] text`),
`error_entry` (first line as message, cut to 500 UTF-16 units, full text as detail) and `remember` (de-dupe, bounded
at 200). Wasm exports in `crates/wf-wasm/src/error_log.rs`: `errorLogIsNoise`, `errorLogConsoleLine`,
`errorLogPushLine`, `errorLogRecordUncaught`, `errorLogEntry`, `errorLogRemember`. The TS callers wrap each call in
try/catch, so a console or fetch call never throws into the app, and before `loadCore()` a failure is logged as new.

Rust builds the report text and the address. TypeScript gathers what happened in the page and passes it in. The buffers are in-memory and tied to the browser session, so Rust does not hold them.

Not regenerated yet: the `errorLog*` exports are untyped until `npm run bindings`.

Error-boundary detail (`apps/web/src/app/error-boundary-parts.ts`, `errorDetail`): `error_detail` in
`crates/wf-core/src/error_report/detail.rs` lays out message, `digest: <d>` and stack, one per line. Empty when there
is no message. The TS wrapper reads `error.stack` inside a try/catch (the getter may throw) and returns `""` when the
core is not loaded yet, so a boundary still renders. Wasm export: `errorDetail` in `crates/wf-wasm/src/error_report_detail.rs`.

Source: `crates/wf-core/src/error_report/`
