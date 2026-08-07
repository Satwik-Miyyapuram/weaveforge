# secrets/

Everything credential-shaped that has to live inside the checkout. The whole
directory is git-ignored, and this README is the only file in it that is ever
committed.

## What belongs here

| File | What it is | Read by |
|---|---|---|
| `.env.migration` | Supabase and OCI connection strings, service role key, R2 and MinIO keys | every `npm run migrate:*` command |
| `.env.oci` | OCIDs for the instance launcher — identifiers rather than secrets, but tenancy-specific | `scripts/oci-launch-retry.*` |
| `*.pem`, `*.key` | Keys a cloud console downloaded into the repo | nothing — see below |

## What cannot live here

Not everything can be moved, because some tools only look in one place:

| File | Where it must stay | Why |
|---|---|---|
| `apps/web/.env.local` | `apps/web/` | Next.js reads it from the app directory and nowhere else |
| `~/.oci/config` + its key | `~/.oci/` | The OCI CLI's default. `OCI_CLI_CONFIG_FILE` can override it, but every documented command assumes the default |
| `~/.ssh/oci_weaveforge` | `~/.ssh/` | Where `ssh` looks, and where the permissions are already correct |

Those live outside the repo entirely, which is better than being ignored inside
it.

## About the keys sitting here

If a `.pem` or `.key` is in this folder, it is almost certainly a **spare copy**
that a browser downloaded into the checkout, not the one anything uses. The
working copies are `~/.oci/oci_api_key.pem` and `~/.ssh/oci_weaveforge`.

Delete the spares. A key you are not using is a key you are not rotating, and
an OCI API key gives full control of the tenancy.

## Why the ignore rules are doubled

`.gitignore` ignores `/secrets/` *and* keeps `*.pem`, `*.key`, `.env*` patterns.
That is deliberate. A directory rule is one careless edit from being wrong, and
these files download into whatever folder the browser last used — which is how
an OCI API key and an SSH key ended up in the repository root in the first
place. They were caught before the commit; the second layer is there for the
time nobody is looking.

Nothing here has ever been committed. If that changes, rotating the key is the
only fix — removing the file from a later commit does not remove it from
history, and anything pushed to a public repository should be treated as
disclosed.
