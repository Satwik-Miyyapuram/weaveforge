---
covers:
  - apps/web/src/features/workspace/application/auto-sync.ts
  - apps/web/src/features/workspace/ui/git-sync-dot.tsx
  - apps/relay/server/src/credential_crypto.rs
  - apps/relay/server/src/overleaf_workshop.rs
  - apps/shell/src/settings_secrets.rs
checked: 2026-11-27
---

# Upgrading to 0.9.8

WeaveForge 0.9.8 opens your workspace folder directly. There is no upgrade check, so the app never holds you back before it opens.

## Without an account

No account is needed. Your notes are files in your workspace folder, and no database is used.
<!-- Sources: apps/web/src/backend/parts.ts:183,222-234 (no-account light backend is files-only); apps/web/src/container/parts.ts:384-386. Local mode itself is kept in 0.9.8 (decision by coordinator). -->

## What changed

- **Sync:** the offline sync feature is removed in 0.9.8. Your notes are files in your workspace folder. Sync with GitHub is a folder sync, and Settings shows which repository the workspace backs up to.
- **Keys:** the server no longer keeps API keys or Overleaf Git links, and keys saved there by earlier versions are no longer read. What it still holds for you, your Overleaf sign-in, is stored encrypted. On the desktop, 0.9.7 moved your keys from the old local database into the system keychain; any key it could not move was named so you can re-enter it in Settings.
