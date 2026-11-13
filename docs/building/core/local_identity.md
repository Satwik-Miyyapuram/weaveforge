# local_identity

Rust home: `crates/wf-core/src/sync/local_identity.rs`. wasm: `crates/wf-wasm/src/sync_local_identity.rs`.
TS callers: `apps/web/src/backend/providers/local/local-identity.ts`, `local-first-marker.ts`.

## What moved

- The localStorage keys (`localModeKey`, `localFirstKey`) and the device-user SQL (`localDeviceUserSql`).
- Local-mode reading: only the stored `"1"` turns it on (`localIsLocalMode`).
- Local-first wiring rule: not in local mode and on the desktop (`localFirstWanted`).
- Marker parsing: `{ id, email }` from JSON, `null` when unreadable or with no string `id`. `email` keeps any non-null
  value as the marker holds it, as the old TS did (`parsed.email ?? null`), so a non-string email is kept (`localFirstMarkerAccount`).
- Device user id: the reported id when non-empty, else the fallback (`localDeviceUserId`).

## What stays in TS

- localStorage reads and writes (`safe-storage`), the desktop bridge lookup, the `LOCAL_USER` object,
  `LocalAuthService`, the session promise cache, and the `setTimeout` in `onChange`.

## Known divergence

- None. A non-string `email` is kept as-is, matching the old TS parser.

## Tests

5 `it:` cases moved to `#[test]` in `local_identity.rs`, plus the local-mode, local-first and SQL rules, and
`a_non_string_email_is_kept_as_the_marker_holds_it`. The TS marker and session tests stay TS and import only;
`local-first.test.ts` adds the non-string email case.
