import { readFileSync } from "node:fs";

/**
 * TLS for the migration scripts' `pg` clients.
 *
 * Loopback and a local socket stay plain: that is the SSH tunnel the runbook
 * uses (docs/running/oracle-shift.md), and the tunnel already encrypts. Any
 * other host gets TLS with the certificate checked, so nobody on the path can
 * pose as the server and collect the password. A self-signed server needs its
 * CA in `PGSSLROOTCERT`, the same variable libpq reads.
 *
 * An `sslmode` in the URL wins over what this returns (pg merges the parsed
 * URL over the config), so `sslmode=no-verify` would quietly undo the check;
 * it is refused for remote hosts.
 */

/** TLS everywhere except a local socket, loopback, or `sslmode=disable`. */
export function wantsTls(url) {
  if (/sslmode=disable/.test(url)) return false;
  if (/[?&]host=%2F|[?&]host=\//.test(url)) return false;
  return !/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
}

/** Spread into a `pg` Client config: `{}` or `{ ssl: {...} }`. */
export function pgTls(url, env = process.env) {
  if (!wantsTls(url)) return {};
  if (/sslmode=no-verify/.test(url)) {
    throw new Error(
      "sslmode=no-verify turns off the server certificate check. Use an SSH tunnel to localhost, or set PGSSLROOTCERT to the server's CA.",
    );
  }
  const ssl = { rejectUnauthorized: true };
  if (env.PGSSLROOTCERT) {
    try {
      ssl.ca = readFileSync(env.PGSSLROOTCERT, "utf8");
    } catch (error) {
      throw new Error(`PGSSLROOTCERT: cannot read ${env.PGSSLROOTCERT} (${error.code ?? error.message})`);
    }
  }
  return { ssl };
}
