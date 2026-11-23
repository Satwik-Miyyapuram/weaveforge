---
covers:
  - apps/web/src/features/workspace/application/install-097-guard.ts
  - apps/web/src/features/workspace/infrastructure/install-097-browser-port.ts
  - apps/web/src/features/workspace/ui/install-097-gate.tsx
  - apps/web/src/features/workspace/application/auto-sync.ts
  - apps/web/src/features/workspace/ui/git-sync-dot.tsx
  - apps/shell/src/migrate.rs
  - apps/relay/server/src/credential_crypto.rs
checked: 2026-11-22
---

# Upgrading to 0.9.8

WeaveForge 0.9.8 may ask you to open 0.9.7 once before the app opens. This page says when that happens, what it checks, and how to get past it.

## Who is asked

Only a device that holds data from an older version is asked. A new install, a new account or a browser with no old data is never held back. The check looks at this device only; it does not ask the server about your account.

- **Desktop:** if an old local database is found, the app shows "Open 0.9.7 once more." and stays closed until 0.9.7 has moved your data across.
- **Web:** if 0.9.7 started moving your data in this browser and the move did not finish here, the app shows "Install 0.9.7 first." Any other browser sees nothing.

## What the check looks at

- **Desktop:** the app opens when there is no old local database. Otherwise it opens only when the 0.9.7 export report in your workspace folder is verified and this device's secrets move is marked done.
- **Web:** the app opens when this browser holds no data from 0.9.7, or when the 0.9.7 export finished in this browser. An export finished on another device does not open this browser: GitHub sync leaves the 0.9.7 report folder out, so the report stays on the device that made it. If this browser's storage cannot be read, the app opens.

If the check cannot be completed, the screen says "WeaveForge could not check the local database.", shows an error code, and says that nothing was moved. Your data is safe.

## How to get past it

- **Desktop:** install or open WeaveForge 0.9.7 so its move finishes, then come back. If the export folder has moved, choose it on the screen. A folder is only kept once it is verified.
- **Web:** install WeaveForge desktop 0.9.7, sign in and export there. Your data is then in that computer's workspace folder. This browser keeps showing the screen afterwards. Do not clear this site's data to get past it: that also deletes the workspace stored in this browser.

The screen links to the 0.9.7 download. On the web there is no folder picker, because the fix is an export, not a folder.

<!-- Keys line depends on the 0.9.7 keys merge (wf-097-keys commit 4593c6f70, desktopMoveSecrets). Check it when 0.9.8 picks up that release. -->

## Without an account

No account is needed. Your notes are files in your workspace folder, and no database is used.
<!-- Sources: apps/web/src/backend/parts.ts:183,222-234 (no-account light backend is files-only); apps/web/src/container/parts.ts:384-386. Local mode itself is kept in 0.9.8 (decision by coordinator). -->

## What changed

- **Sync:** the offline sync feature is removed in 0.9.8. Your notes are files in your workspace folder. Sync with GitHub is a folder sync, and Settings shows which repository the workspace backs up to.
- **Keys:** keys stay sealed. Integration credentials that the server holds are stored encrypted, not as plain text. On the desktop, the old encrypted `secrets.json` from 0.9.7 is not copied into the new workspace. Keys are moved to the system keychain instead, and any key that could not be moved is named so you can re-enter it in Settings.
