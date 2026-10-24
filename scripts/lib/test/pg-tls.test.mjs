import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";
import { pgTls, wantsTls } from "../pg-tls.mjs";

/**
 * The migration scripts carry the production database password. They used to
 * connect with `rejectUnauthorized: false`, so anyone on the path could stand
 * in for the server and read it. TLS to a remote host now verifies the
 * certificate; loopback and a local socket (the SSH tunnel the runbook uses)
 * stay plain.
 */

const remote = "postgres://weaveforge:pw@db.example.org:5432/weaveforge";
const dir = mkdtempSync(path.join(tmpdir(), "pg-tls-"));
after(() => rmSync(dir, { recursive: true, force: true }));

describe("wantsTls", () => {
  it("is off for loopback hosts", () => {
    assert.equal(wantsTls("postgres://u:p@localhost:15432/d"), false);
    assert.equal(wantsTls("postgres://u:p@127.0.0.1:5432/d"), false);
    assert.equal(wantsTls("postgres://u:p@[::1]:5432/d"), false);
    assert.equal(wantsTls("postgres://u:p@localhost/d"), false);
  });

  it("is off for a local socket, encoded or not", () => {
    assert.equal(wantsTls("postgres://u@/d?host=/var/run/postgresql"), false);
    assert.equal(wantsTls("postgres://u@/d?host=%2Fvar%2Frun%2Fpostgresql"), false);
    assert.equal(wantsTls("postgres://u@/d?user=u&host=/tmp"), false);
  });

  it("is off when the URL says sslmode=disable", () => {
    assert.equal(wantsTls(`${remote}?sslmode=disable`), false);
  });

  it("is on for a remote host", () => {
    assert.equal(wantsTls(remote), true);
    assert.equal(wantsTls(`${remote}?sslmode=require`), true);
  });

  it("does not take a remote host that only starts with localhost for loopback", () => {
    assert.equal(wantsTls("postgres://u:p@localhost.example.org:5432/d"), true);
  });
});

describe("pgTls", () => {
  it("adds nothing when TLS is off", () => {
    assert.deepEqual(pgTls("postgres://u:p@localhost:5432/d", {}), {});
  });

  it("verifies the server certificate for a remote host", () => {
    assert.deepEqual(pgTls(remote, {}), { ssl: { rejectUnauthorized: true } });
  });

  it("trusts the CA named by PGSSLROOTCERT", () => {
    const ca = path.join(dir, "root.crt");
    writeFileSync(ca, "-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----\n");
    const { ssl } = pgTls(remote, { PGSSLROOTCERT: ca });
    assert.equal(ssl.rejectUnauthorized, true);
    assert.match(ssl.ca, /BEGIN CERTIFICATE/);
  });

  it("fails loudly when PGSSLROOTCERT names a missing file", () => {
    assert.throws(() => pgTls(remote, { PGSSLROOTCERT: path.join(dir, "nope.crt") }), /PGSSLROOTCERT/);
  });

  it("refuses sslmode=no-verify for a remote host", () => {
    assert.throws(() => pgTls(`${remote}?sslmode=no-verify`, {}), /no-verify/);
  });
});

describe("migration scripts", () => {
  it("never turn certificate checks off", () => {
    const scripts = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const offenders = readdirSync(scripts, { recursive: true })
      .filter((name) => name.endsWith(".mjs") && !name.includes("test"))
      .filter((name) => /rejectUnauthorized:\s*false/.test(readFileSync(path.join(scripts, name), "utf8")));
    assert.deepEqual(offenders, []);
  });
});
