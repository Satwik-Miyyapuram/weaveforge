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

The one real call site is `apps/web/src/lib/error-report/issue-url.ts`. Its header says the address and body are "built in Rust (`wf_core::error_report::issue_url`)". Line 25 calls `readyCore().newIssueUrl(input.title, input.body, input.repo ?? reportRepo())`. Line 30 calls `readyCore().reportMarkdown(input)`.

No direct app call to `redactReport` or `redactReportAndCap` was found in `apps/web/src`. The redaction exports exist for the core and are ready for callers that need them.

## What stays in TypeScript, and why

The log capture stays in TypeScript. These files hold live app state that only exists in the browser:

- `apps/web/src/lib/error-report/app-log.ts` writes app log lines.
- `apps/web/src/lib/error-report/log-buffer.ts` keeps the recent-log buffer.
- `apps/web/src/lib/error-report/request-log.ts` records request history.
- `apps/web/src/lib/error-report/warn-once.ts` suppresses repeated warnings.

Rust builds the report text and the address. TypeScript gathers what happened in the page and passes it in. The buffers are in-memory and tied to the browser session, so Rust does not hold them.

Source: `crates/wf-core/src/error_report/`
