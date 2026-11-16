# Hosting the help site and demo

The help site is at `docs.weaveforge.org`. Its live demo is at `demo.weaveforge.org`, and each how-to frames that demo. Both are served from the OCI host by Caddy, behind the Cloudflare Tunnel. Nothing is live until the steps below are done in order.

## What runs where

| Host | Local port | Serves | Source |
| --- | --- | --- | --- |
| `docs.weaveforge.org` | `127.0.0.1:8082` | `docs/.site` (help pages) | `scripts/build-user-docs.mjs` |
| `demo.weaveforge.org` | `127.0.0.1:8081` | `docs/.site-demo` (the app) | `scripts/user-docs/build-demo-app.mjs` |

The demo frames only from `https://docs.weaveforge.org` (`frame-ancestors` in `infra/oci/Caddyfile`). The help site allows no framing.

The compose directory on the host gets `demo-site/` and `docs-site/`, which the gateway mounts read-only at `/srv/demo` and `/srv/docs`.

## Go-live checklist

1. **Cloudflare Tunnel ingress.** Add two rules to the tunnel config, before the catch-all:
   - `docs.weaveforge.org` → `http://127.0.0.1:8082`
   - `demo.weaveforge.org` → `http://127.0.0.1:8081`
2. **DNS.** Point `docs` and `demo` at the tunnel (CNAME to the tunnel hostname, proxied). Do not open any port on the VM.
3. **GitHub environment.** Create the `docs-hosting` environment on the repo. Add required reviewers, since a deploy copies the site to the server.
4. **Environment secrets** (`docs-hosting`):
   - `DEPLOY_SSH_KEY`: private key for a deploy-only user on the VM.
   - `DEPLOY_KNOWN_HOSTS`: the VM's host key line, from `ssh-keyscan`, checked by hand.
5. **Environment variables** (`docs-hosting`):
   - `DEPLOY_HOST`: the VM's address.
   - `DEPLOY_USER`: the deploy user.
   - `DEPLOY_PATH`: the compose directory, for example `/home/ubuntu/weaveforge-infra`.
6. **Compose and Caddy on the VM.** Copy the updated `infra/oci/docker-compose.yml` and `infra/oci/Caddyfile`, then run `docker compose up -d gateway`. The gateway needs the `demo-site` and `docs-site` directories to exist, or Docker creates them as root; create them first.
7. **First deploy.** Run the `User docs build` workflow with `deploy` ticked. Check the build job, then approve the `deploy` job.
8. **Verify.**
   - `https://docs.weaveforge.org/` loads the home page.
   - Open a how-to, for example `https://docs.weaveforge.org/notes.html`. Its demo frame loads from `https://demo.weaveforge.org/`.
   - `curl -I https://demo.weaveforge.org/` shows `content-security-policy: frame-ancestors https://docs.weaveforge.org`.
9. **Pitch site.** The next Pages deploy sends `/docs/*` to the help site. Old links to `/docs/...` redirect to the matching page or to the docs home.

## Running it locally

The demo's frames default to production. To frame a local demo instead:

```
node scripts/user-docs/build-demo-app.mjs
node scripts/build-user-docs.mjs --local
```

`DOCS_DEMO_URL=... node scripts/build-user-docs.mjs` overrides both. The value must be an absolute `http(s)` URL.

## Rolling back

Run the workflow again with an earlier commit, or copy the previous `docs-site` artifact over `docs-site/` on the host. Caddy serves whatever is on disk, so no restart is needed.
