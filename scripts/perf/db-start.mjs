#!/usr/bin/env node
// Times the phases of the local database start, the way the shell runs them
// (apps/shell/src/local_pg): initdb (first run only), postgres spawn until it
// answers, connect, migrate (bootstrap + ledger + pending migrations), local user.
// It runs on a scratch cluster in the temp dir, never on an app's data.
//
// Usage: node scripts/perf/db-start.mjs --bin <postgres bin dir> [--shim <exe>] [--runs 5] [--json]
//        (or set WEAVEFORGE_PG_BIN). On Windows a cmd AutoRun breaks the tools' `postgres -V`
//        check; --shim <weaveforge-shell.exe> uses the shell's ComSpec shim (local_pg/comspec.rs),
//        which only runs `cmd /d /c` and exits. Default: <bin>/../../weaveforge-shell.exe if present.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import pg from "pg";

const repo = resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const bin = flag("--bin") ?? process.env.WEAVEFORGE_PG_BIN;
const runs = Number(flag("--runs") ?? 5);
const asJson = args.includes("--json");
if (!bin) {
  console.error("Give the Postgres bin dir: --bin <dir> or WEAVEFORGE_PG_BIN");
  process.exit(2);
}
const shimFlag = flag("--shim") ?? join(bin, "..", "..", "weaveforge-shell.exe");
const shim = process.platform === "win32" && existsSync(shimFlag) ? shimFlag : undefined;
// Windows env names ignore case: drop every spelling of ComSpec before setting the shim.
const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toLowerCase() !== "comspec"));
const env = shim ? { ...base, ComSpec: shim, WEAVEFORGE_COMSPEC_SHIM: "1" } : process.env;
const exe = (tool) => join(bin, process.platform === "win32" ? `${tool}.exe` : tool);

// The SQL and tuning come from the shell's own sources, so the script cannot drift from them.
const dbRs = readFileSync(join(repo, "apps/shell/src/local_pg/db.rs"), "utf8");
const serverRs = readFileSync(join(repo, "apps/shell/src/local_pg/server.rs"), "utf8");
const rustString = (src, name) => {
  const m = src.match(new RegExp(`pub const ${name}: &str = r#"([\\s\\S]*?)"#;`));
  if (!m) throw new Error(`${name} not found in the shell sources`);
  return m[1];
};
const BOOTSTRAP = rustString(dbRs, "LOCAL_BOOTSTRAP_SQL");
const LEDGER = rustString(dbRs, "LEDGER_SQL");
const tuningBlock = serverRs.match(/const TUNING: [^=]+= &\[([\s\S]*?)\];/)?.[1] ?? "";
const TUNING = [...tuningBlock.matchAll(/\("([^"]+)", "([^"]+)"\)/g)].map((m) => `${m[1]}=${m[2]}`);
const USER_SQL = "insert into auth.users (id, email) values ($1, $2) on conflict (id) do nothing";
const USER = ["00000000-0000-4000-8000-000000000001", "local@weaveforge.invalid"];

function migrationFiles() {
  const out = [];
  for (const dir of ["db/migrations", "db/migrations-local"]) {
    const base = dir.split("/").pop();
    for (const name of readdirSync(join(repo, dir)).filter((n) => n.endsWith(".sql")).sort()) {
      out.push([`${base}/${name}`, readFileSync(join(repo, dir, name), "utf8")]);
    }
  }
  return out;
}

function freePort() {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.on("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

const client = (port, password) =>
  new pg.Client({ host: "127.0.0.1", port, user: "wf", password, database: "postgres" });

async function waitReady(child, port, password) {
  for (;;) {
    if (child.exitCode !== null) throw new Error("postgres exited at start");
    const c = client(port, password);
    try {
      await c.connect();
      await c.end();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

async function migrate(c, files) {
  await c.query(BOOTSTRAP);
  await c.query(LEDGER);
  const applied = new Set((await c.query("select name from weaveforge_migrations")).rows.map((r) => r.name));
  let ran = 0;
  for (const [name, sql] of files) {
    if (applied.has(name)) continue;
    await c.query("BEGIN");
    await c.query("insert into weaveforge_migrations (name) values ($1)", [name]);
    await c.query(sql);
    await c.query("COMMIT");
    ran++;
  }
  return ran;
}

/** One open as the shell does it, with each phase timed in ms. */
async function open(root, password) {
  const t = {};
  let at = performance.now();
  const lap = (name) => {
    const now = performance.now();
    t[name] = Math.round((now - at) * 10) / 10;
    at = now;
  };
  const files = migrationFiles();
  lap("readMigrationFiles");
  const port = await freePort();
  const child = spawn(exe("postgres"), ["-D", join(root, "data"), "-p", String(port), ...TUNING.flatMap((kv) => ["-c", kv])], {
    stdio: "ignore",
    env,
  });
  await waitReady(child, port, password);
  lap("spawnUntilReady");
  const c = client(port, password);
  await c.connect();
  lap("connect");
  await c.query(BOOTSTRAP);
  lap("bootstrapSql");
  await c.query(LEDGER);
  const applied = new Set((await c.query("select name from weaveforge_migrations")).rows.map((r) => r.name));
  lap("ledgerAndApplied");
  t.migrationsRun = 0;
  const pending = files.filter(([name]) => !applied.has(name));
  if (pending.length) t.migrationsRun = await migrate(c, pending);
  lap("pendingMigrations");
  await c.query(USER_SQL, USER);
  lap("localUser");
  await c.end();
  const stopAt = performance.now();
  spawnSync(exe("pg_ctl"), ["stop", "-D", join(root, "data"), "-m", "fast", "-w"], { stdio: "ignore", env });
  t.stop = Math.round((performance.now() - stopAt) * 10) / 10;
  return t;
}

const root = mkdtempSync(join(tmpdir(), "wf-db-start-"));
try {
  const password = randomBytes(24).toString("hex");
  writeFileSync(join(root, "password"), password);
  const initAt = performance.now();
  const init = spawnSync(
    exe("initdb"),
    ["-D", join(root, "data"), "-U", "wf", "--auth=scram-sha-256", "--pwfile", join(root, "password"), "-E", "UTF8", "--no-locale", "--no-instructions"],
    { encoding: "utf8", env },
  );
  if (init.status !== 0) throw new Error(`initdb failed: ${init.stderr}`);
  const initdbMs = Math.round(performance.now() - initAt);
  const first = await open(root, password);
  const warm = [];
  for (let i = 0; i < runs; i++) warm.push(await open(root, password));
  const median = (key) => {
    const v = warm.map((w) => w[key]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  };
  const keys = Object.keys(warm[0]).filter((k) => k !== "migrationsRun");
  const warmMedian = Object.fromEntries(keys.map((k) => [k, median(k)]));
  const result = { initdbMs, first, warmMedian, runs };
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`initdb (first run only): ${initdbMs} ms`);
    console.log(`first open (all ${first.migrationsRun} migrations):`);
    for (const k of keys) console.log(`  ${k.padEnd(20)} ${first[k]} ms`);
    console.log(`warm open, median of ${runs}:`);
    for (const k of keys) console.log(`  ${k.padEnd(20)} ${warmMedian[k]} ms`);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
