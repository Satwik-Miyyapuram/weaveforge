# Tier upgrade from 0.9.2

0.9.2 remembered how a copy worked in the page's storage. 0.9.4 keeps that in
the workspace's `.weaveforge/settings.json` as a tier (`local`, `local-web` or
`sharing`). On the first 0.9.4 start on the desktop, the app reads the old
flags once and writes the matching tier.

| What 0.9.2 left | Tier written |
| --- | --- |
| `weaveforge.local-mode` set to `1` | `local` |
| A Supabase session, or a local-first account marker | `sharing`, with the marker's account id when there is one |
| Neither (a fresh install) | `local` |

The local-mode flag wins when both are present, because the person chose it
last.

## When it runs

`OldDbImportGate` (`apps/web/src/features/startup/ui/old-db-import-gate.tsx`)
runs it first, before the 0.8 data import. The work is in
`apps/web/src/features/startup/application/upgrade-tier.ts`:

- `tierFromOldFlags` is the table above.
- `upgradeTier` writes the tier through the desktop shell and the page's
  mirror, removes the local-mode flag and sets `weaveforge.tier-upgraded`.

The done key makes it run once. A later start never changes the tier again,
even after the flags are gone.

If writing the tier fails (for example, no folder is open yet), the flags and
the done key stay as they were. The old flags still work, and the next start
tries again.

## Not done yet

- Moving the old session into the keychain. `upgradeTier` calls
  `moveSession` when it is given one; the real one comes with the server
  profile work (Lane L).
- Offering to connect a git remote on a fresh install. `upgradeTier` returns
  `freshInstall: true` for the setup screen to use.
- Removing the local-first marker. It still decides whether the window is
  wired local-first, so it stays until that wiring reads the tier.

## Tests

`apps/web/src/features/startup/test/upgrade-tier.test.ts` covers the three
mappings, a second run doing nothing, and a failed write leaving everything
for the next start.
