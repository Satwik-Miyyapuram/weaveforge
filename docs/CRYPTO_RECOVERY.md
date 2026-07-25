# Encryption recovery and remembered devices

## What is implemented

New accounts receive a random browser-device secret. The secret stays in a
dedicated browser store and is never derived from a Google ID, account password,
or an API token. The server stores an Argon2id-derived encrypted wrap of the
user master key, not the secret itself. The primary recovery path is an email
magic link. The browser wraps the UMK under a fresh random secret, and that
secret is included only in the one-time recovery link. The database stores only
an Argon2id-derived encrypted UMK wrapper. An optional recovery passphrase and
one-time code can also be configured as a fallback.

Each browser has an independent device ID and independent encrypted UMK wrap.
Signing out or revoking one browser does not invalidate another browser's wrap.
The original `user_keys` wrapper remains as a migration bridge for legacy
accounts and is replaced with a device-based wrapper during the first unlock.
Legacy Google users remain able to use the app while this setup is incomplete,
but see a persistent in-app warning until recovery credentials are configured.

## Adding another browser

1. The new browser signs in and creates a short-lived transfer request.
2. The request contains only a requester device ID and an X25519 public key.
3. An already-unlocked browser sees the request and approves or rejects it.
4. Approval seals the UMK to the requester's public key in the browser. The
   server stores only the opaque sealed envelope and status metadata.
5. The new browser opens the envelope locally, creates its own device wrap, and
   can unlock automatically on future sign-ins.

Requests expire quickly and are owner-scoped by RLS. A rejected, expired, or
revoked request cannot be opened.

## Email verification boundary

An email recovery link both verifies the account and carries the random secret
needed to unwrap the encrypted UMK locally. The server never receives that
secret. Requesting a new link rotates the wrapper and invalidates the previous
link. Anyone who controls the email account can therefore recover the research
data, which is the explicit usability/security trade-off for this simple app.

## Managing recovery credentials

The Settings page provides email recovery directly and a popup for the optional
recovery passphrase. Email recovery rotates the random link secret whenever a
new link is requested. The passphrase popup can create or change the optional
passphrase and creates a fresh one-time recovery code.

## Account password versus encryption recovery

Email/password accounts can change their login password from Settings or use
the password-reset email flow. Google-only accounts do not show account
password controls because Google owns that credential. Changing the login
password never changes the encryption key, recovery link, passphrase, or code.

The sign-in screen also offers an email sign-in magic link. On a new browser,
signing in with that link does not by itself decrypt existing content; the user
must complete one of the explicit recovery or device-transfer paths. This keeps
email authentication separate from possession of the encrypted workspace key.

The sign-in screen also supports a numeric email OTP when the Supabase email
template includes the provider token. OTP verification signs the user in but
does not replace encryption recovery on an unremembered browser.

## Database objects

- `user_device_key_wraps`: one encrypted UMK wrap per active browser device.
- `user_device_transfer_requests`: short-lived owner-scoped transfer requests
  and opaque sealed response envelopes.

Both tables have RLS ownership policies. No service-role credential is used in
the browser path.

## Testing email recovery

The cryptographic path is covered by the core recovery tests. The browser test
is intentionally opt-in because the email link is a real bearer secret:

1. Enable email recovery from an unlocked test account.
2. Open the received link in a fresh browser profile.
3. Put the complete URL in the local-only `E2E_RECOVERY_LINK` environment
   variable.
4. Run the Playwright suite from `apps/web`.

The URL is never committed or printed by the test harness. Supabase Auth must
allow both the application origin and `/recover` as redirect URLs.
