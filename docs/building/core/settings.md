# Settings core module

The `settings` module holds the pure rules for user settings: how settings and
integration credentials are hydrated and normalised, how appearance preferences
are cleaned, and how an uploaded theme config file is parsed and checked. It
treats the theme file as untrusted input. It does no I/O.

## What lives in Rust

Source: `crates/wf-core/src/settings/`

- `user_settings.rs`: hydrates and normalises user settings and applies integration fields.
- `user_appearance.rs`: normalises the appearance preferences.
- `theme_config.rs`: parses the uploadable theme config file. It checks colours, font stacks and lengths against allowlists and caps the file at 64 KB.
- `integration_credentials.rs`: reads integration fields and checks whether an integration is connected. It also converts the legacy credentials layout.
- `settings_file.rs`: the workspace settings file (`.weaveforge/settings.json`, synced with the workspace) and the device settings file (`.weaveforge/local/device.json`, this machine only). Each is one JSON object; empty text reads as an empty object. `apply_patch` sets the keys a patch names and removes those it sets to `null`.
- `secret_guard.rs`: refuses secrets in workspace config files. A key whose name ends in token, secret, password, passwd, apikey, accesskey, privatekey, cookie, credential(s) or bearer (ignoring case, `-` and `_`) with a non-empty string value is refused, and so is any value shaped like a known token (`sk-`, `ghp_`, `github_pat_`, `glpat-`, `xoxb-`, `AKIA` and similar, followed by at least 16 token characters, or a PEM private key). `maxTokens`, `tokenizer` and `passwordHint` are fine. The refusal names where the secret was (for example `integrations.zotero.apiKey`) and never the value.

`mod.rs` describes the module as user settings (the uploadable theme config
file and appearance preferences), pure rules only.

## How the app calls it

The wasm exports live in `crates/wf-wasm/src` (`user_settings.rs`,
`user_appearance.rs`, `theme_config.rs`, `integration_credentials.rs`). The
TypeScript wrappers in `packages/wf-wasm/src` import the raw names from
`../pkg/wf_wasm.js` and re-export them. The main names are:

- User settings: `hydrateUserSettings`, `normalizeUserSettings`,
  `applyUserIntegrationFields`, `needsDisclaimerAcceptance`.
- Appearance: `normalizeAppearance`.
- Theme config: `parseThemeConfig`,
  `normalizeThemeConfig`, `themeConfigTemplate`.
- Integration credentials: `getUserIntegrationField`, `isUserIntegrationConnected`,
  `integrationsBagFromLegacy`.

The `user_settings` row queries run in Rust (`repos/user_settings.rs`, see
[data-access](data-access.md)).

Code in `apps/web` reads these through `readyCore()` or `typedCore()` from
`apps/web/src/lib/rust-core.ts`, or through the wrappers in `packages/wf-wasm`.
`readyCore()` throws until `loadCore()` has resolved, so call it only after
the core has loaded.

## What stays in TypeScript, and why

- **Persistence and use cases.** Loading and saving settings and credentials
  through the database, and the use cases that call them, stay in
  `packages/core/src/features/settings`. Rust normalises the values it is given;
  it never stores them.
- **File reading.** The browser reads the uploaded theme file and passes its
  text to Rust. Rust does the size check and the parse, so the rule applies the
  same way in every caller.
- **Hooks and screens.** The settings screens, the theme preview and the
  appearance controls stay in `apps/web`.
- **Type contracts.** The TypeScript types for settings, appearance and theme
  shapes stay in `packages/core` and `packages/wf-wasm/src`, because the app
  type-checks against them.

## Where secrets go

Secrets live in the system keychain (`apps/shell/src/secrets.rs`), never in a
workspace file. The shell's `file_write` command runs `check_config_write`, and
`file_write_bytes` and `file_rename` run `check_config_bytes` on the bytes that
land at the destination (a config file that is not UTF-8 is refused,
`config_bytes_checked_like_text`), on every write to a config file (any `.json` or `.jsonl` below a `.weaveforge/`
folder at any depth, and any `.overleaf.json`), so a secret is refused before it
reaches the disk or git. Case is ignored and trailing dots and spaces are
dropped from each part of the path, since Windows and macOS open the same file
under those spellings (`config_paths_ignore_case_and_depth`). The one exception
is `NOT_CONFIG_DIRS`: the root `.weaveforge/cache/pdf-text/` folder holds copies
of papers' own text, which may print something token-shaped, so it is not a
config folder (`pdf_text_cache_is_not_config`).
A machine without a keychain keeps the secret in memory for the session only
(`no_store_write_read_clear_behave_as_no_keychain` in
`apps/shell/tests/secrets.rs`).

A `settings.json` written by an older version may still hold a secret. When a
workspace opens, the shell moves each one to the `settings-legacy` keychain
entry, one JSON object keyed by where the value sat (for example
`integrations.zotero.apiKey`), then rewrites the file without them
(`apps/shell/src/settings_secrets.rs`; `split_legacy_secrets` in
`settings_file.rs`). The file changes only after the keychain holds the values
and only if nobody changed it meanwhile. Without a keychain, or with a secret
inside a list, the file is left as it is (`apps/shell/tests/settings_secrets.rs`,
`legacy_secrets_split_out` in `settings_files.rs`).

## Laws

Each law is a property test in `crates/wf-core/tests/settings_files.rs`.

- **No secret value is ever written to a workspace file.** A secret-named key or
  a token-shaped value planted anywhere in random nested settings makes
  `render_settings` fail, and `check_config_write` refuses the same text for
  `settings.json`, `local/device.json` and an AI proposal file
  (`law_no_secret_written`).
- **Settings read back as written, and a patch touches only the keys it names**
  (`law_settings_round_trip_and_patch`).

Named cases in the same file: the refusal message names the key but never the
value, `device.json` is not synced, `.overleaf.json` refuses a token, and AI
proposal and audit paths refuse unsafe ids.

## Related

- [AI core](ai.md)
- [Dashboard core](dashboard.md)
- [Plan core](plan.md)
- [Logbook core](logbook.md)

Source: `crates/wf-core/src/settings/`
