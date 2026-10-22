/**
 * Guards the OCI server's API stack against the 2026-10-22 outage coming back.
 *
 * That day PostgREST's connection pool wedged while the process stayed up, and
 * api.weaveforge.org answered 504 for two hours. The fix has two halves, and
 * this checks both:
 *
 * 1. `infra/oci/docker-compose.yml`: PostgREST is pinned to a version (not
 *    `latest`, which jumped major versions on a pull), and its healthcheck is
 *    `postgrest --ready` in exec form. The v16 image has no shell, so a
 *    `CMD-SHELL` check fails forever and the watchdog restarts PostgREST in a
 *    loop. `--ready` needs the admin server on a loopback host; it refuses a
 *    wildcard one.
 * 2. `infra/oci/api-watch.sh`, the host watchdog, is run against stub `docker`,
 *    `curl`, `logger` and `sleep` commands to prove it restarts an unhealthy
 *    container, restarts PostgREST after three failed API probes, and leaves a
 *    healthy, starting or stopped one alone.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const fail = (message) => failures.push(message);

// ── 1. docker-compose.yml ────────────────────────────────────────────────────

const compose = readFileSync(path.join(root, "infra/oci/docker-compose.yml"), "utf8").replace(/\r\n/g, "\n");
// The postgrest service block: from its key to the next top-level service.
const postgrest = /\n {2}postgrest:\n([\s\S]*?)(?=\n {2}[\w-]+:\n|$)/.exec(compose)?.[1];

if (!postgrest) {
  fail("docker-compose.yml: no `postgrest:` service found");
} else {
  const image = /^\s*image:\s*(\S+)/m.exec(postgrest)?.[1] ?? "";
  if (!/^postgrest\/postgrest:v\d+(\.\d+)+$/.test(image)) {
    fail(`docker-compose.yml: PostgREST image is "${image}"; pin an exact version like postgrest/postgrest:v16.5`);
  }

  const test = /^\s*test:\s*(.+)$/m.exec(postgrest)?.[1]?.trim() ?? "";
  if (!/^\[\s*"CMD"\s*,\s*"postgrest"\s*,\s*"--ready"\s*\]$/.test(test)) {
    fail(`docker-compose.yml: PostgREST healthcheck is ${test || "missing"}; it must be ["CMD", "postgrest", "--ready"] (the image has no shell)`);
  }

  const adminHost = /^\s*PGRST_ADMIN_SERVER_HOST:\s*"?([^"\s#]+)/m.exec(postgrest)?.[1];
  if (adminHost !== "127.0.0.1" && adminHost !== "localhost") {
    fail(`docker-compose.yml: PGRST_ADMIN_SERVER_HOST is ${adminHost ?? "unset"}; \`postgrest --ready\` needs a loopback host`);
  }
  if (!/^\s*PGRST_ADMIN_SERVER_PORT:\s*"?\d+/m.test(postgrest)) {
    fail("docker-compose.yml: PGRST_ADMIN_SERVER_PORT is unset; `postgrest --ready` needs the admin server");
  }
}

// ── 2. api-watch.sh, against stubs ───────────────────────────────────────────

// The script with LF endings, so a Windows checkout runs the same bytes as the server.
const watchScript = readFileSync(path.join(root, "infra/oci/api-watch.sh"), "utf8").replace(/\r\n/g, "\n");

// Each stub appends what it was called with to $CALLS.
//  docker inspect: health from $HEALTH_<name> (dashes as underscores), running
//    state from $RUNNING (default "true"); docker restart: succeeds.
//  curl: fails the first $CURL_FAILS calls, then succeeds.
const stubs = {
  docker: String.raw`#!/usr/bin/env bash
echo "docker $*" >> "$CALLS"
if [ "$1" = inspect ]; then
  name=${"$"}{!#}
  var="HEALTH_${"$"}{name//-/_}"
  health=${"$"}{!var-}
  case "$3" in
    *State.Running*) echo "${"$"}{RUNNING:-true} $health" ;;
    *) echo "$health" ;;
  esac
fi
exit 0
`,
  curl: String.raw`#!/usr/bin/env bash
echo "curl" >> "$CALLS"
n=$(grep -c '^curl' "$CALLS")
[ "$n" -gt "${"$"}{CURL_FAILS:-0}" ]
`,
  logger: `#!/usr/bin/env bash\necho "logger $*" >> "$CALLS"\n`,
  sleep: `#!/usr/bin/env bash\necho "sleep $*" >> "$CALLS"\n`,
};

const dir = mkdtempSync(path.join(tmpdir(), "api-watch-"));
const bin = path.join(dir, "bin");
mkdirSync(bin);
for (const [name, body] of Object.entries(stubs)) {
  const file = path.join(bin, name);
  writeFileSync(file, body);
  chmodSync(file, 0o755);
}
const script = path.join(dir, "api-watch.sh");
writeFileSync(script, watchScript);

let run = 0;
function watch(env) {
  const calls = path.join(dir, `calls-${run++}.log`);
  writeFileSync(calls, "");
  const result = spawnSync("bash", [script], {
    env: { ...process.env, ...env, CALLS: calls, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
    encoding: "utf8",
  });
  const log = readFileSync(calls, "utf8").split("\n").filter(Boolean);
  return {
    status: result.status,
    restarts: log.filter((line) => line.startsWith("docker restart")).map((line) => line.split(" ")[2]),
    curls: log.filter((line) => line === "curl").length,
    sleeps: log.filter((line) => line.startsWith("sleep")).length,
    error: result.error?.message ?? result.stderr,
  };
}

function expect(label, env, want) {
  const got = watch(env);
  if (got.status !== 0) {
    fail(`api-watch.sh, ${label}: exited ${got.status}: ${got.error}`);
    return;
  }
  for (const key of Object.keys(want)) {
    if (JSON.stringify(got[key]) !== JSON.stringify(want[key])) {
      fail(`api-watch.sh, ${label}: ${key} was ${JSON.stringify(got[key])}, expected ${JSON.stringify(want[key])}`);
    }
  }
}

const healthy = { HEALTH_weaveforge_postgrest: "healthy", HEALTH_weaveforge_realtime: "healthy" };

expect("all healthy, API answers", healthy, { restarts: [], curls: 1, sleeps: 0 });
expect("API answers on the third try", { ...healthy, CURL_FAILS: "2" }, { restarts: [], curls: 3, sleeps: 2 });
// The 2026-10-22 outage: healthy by Docker's account, every request failing.
expect("API fails three times (wedged pool)", { ...healthy, CURL_FAILS: "3" }, {
  restarts: ["weaveforge-postgrest"],
  curls: 3,
  sleeps: 2,
});
expect("realtime unhealthy", { ...healthy, HEALTH_weaveforge_realtime: "unhealthy" }, {
  restarts: ["weaveforge-realtime"],
  curls: 1,
});
expect("PostgREST unhealthy", { ...healthy, HEALTH_weaveforge_postgrest: "unhealthy" }, {
  restarts: ["weaveforge-postgrest"],
});
expect("PostgREST still starting", { ...healthy, HEALTH_weaveforge_postgrest: "starting", CURL_FAILS: "9" }, {
  restarts: [],
  curls: 0,
});
expect("PostgREST stopped on purpose", { ...healthy, RUNNING: "false", CURL_FAILS: "9" }, {
  restarts: [],
  curls: 0,
});

if (failures.length) {
  console.error("FAIL: the OCI API stack would not survive a wedged PostgREST pool.");
  for (const message of failures) console.error(`  ${message}`);
  process.exit(1);
}
console.log("oci-infra: PostgREST pinned with a shell-free healthcheck; api-watch.sh passed 7 scenarios");
