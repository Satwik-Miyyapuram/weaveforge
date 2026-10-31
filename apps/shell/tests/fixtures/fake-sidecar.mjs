// Fake sidecar for the Rust client tests. Speaks the same line protocol as the real one.
import readline from "node:readline";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";

const ignoreEof = process.argv.includes("--ignore-eof");
const noRead = process.argv.includes("--no-read");
const badState = process.argv.includes("--bad-state");
const slowState = process.argv.includes("--slow-state");
const resetRefuse = process.argv.includes("--reset-refuse");
// Like the real sidecar's lazy open: once a query has run, the state reports where the database came from.
const reportOpen = process.argv.includes("--report-open");
let opened = false;
let nextAsk = 1;
const asks = new Map();
const markerIndex = process.argv.indexOf("--restart-marker");
const restartMarker = markerIndex >= 0 ? process.argv[markerIndex + 1] : null;

function reply(r) {
  process.stdout.write(JSON.stringify(r) + "\n");
}

const spawnIndex = process.argv.indexOf("--spawn-log");
if (spawnIndex >= 0) appendFileSync(process.argv[spawnIndex + 1], "spawn\n");

// Like the real sidecar: the first process to see a missing marker creates it, then asks for a restart until
// it is replaced.
let asked = false;
function wantsRestart() {
  if (asked) return true;
  if (restartMarker === null || existsSync(restartMarker)) return false;
  writeFileSync(restartMarker, "");
  asked = true;
  return true;
}

process.stderr.write("ready\n");

if (noRead) {
  // Never reads stdin, so the client's writes back up into the pipe.
  setInterval(() => {}, 1000);
} else {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

  rl.on("line", (line) => {
    const msg = JSON.parse(line);
    if (Object.hasOwn(msg, "answer")) {
      const waiter = asks.get(msg.answer);
      if (waiter) { asks.delete(msg.answer); waiter(line); }
      return;
    }
    const { id, method, params } = msg;
    switch (method) {
      case "echo":
        reply({ id, ok: true, value: params });
        break;
      case "cwd":
        reply({ id, ok: true, value: process.cwd() });
        break;
      case "slow":
        setTimeout(() => reply({ id, ok: true, value: params }), params.ms);
        break;
      case "fail":
        reply({ id, ok: false, error: "boom" });
        break;
      case "noreply":
        break;
      case "crash":
        process.exit(7);
        break;
      case "junk":
        process.stdout.write("not json\n");
        reply({ id, ok: true, value: "after-junk" });
        break;
      case "big":
        reply({ id, ok: true, value: "x".repeat(params.n) });
        break;
      case "query":
        opened = true;
        if (params.sql === "fail") {
          reply({ id, ok: false, error: "relation missing" });
        } else if (params.sql === "scalar") {
          reply({ id, ok: true, value: 5 });
        } else if (params.sql === "pid") {
          reply({ id, ok: true, value: [{ pid: process.pid }] });
        } else {
          reply({ id, ok: true, value: [{ sql: params.sql, params: params.params }] });
        }
        break;
      case "state": {
        const send = () =>
          reply({ id, ok: true, value: {
            failure: null,
            dataDir: "/fake",
            restoredFrom: reportOpen && opened ? "opened" : null,
            restart: wantsRestart(),
          } });
        if (badState) {
          reply({ id, ok: true, value: 42 });
        } else if (slowState) {
          setTimeout(send, 1000);
        } else {
          send();
        }
        break;
      }
      case "reset":
        if (resetRefuse) {
          reply({ id, ok: false, error: "nothing to reset" });
        } else {
          reply({ id, ok: true, value: { restart: wantsRestart() } });
        }
        break;
      case "ask": {
        const k = nextAsk++;
        asks.set(k, (raw) => reply({ id, ok: true, value: raw }));
        process.stdout.write(JSON.stringify({ ask: k, method: params.method, params: params.params }) + "\n");
        break;
      }
      case "badask": {
        const k = nextAsk++;
        asks.set(k, (raw) => reply({ id, ok: true, value: raw }));
        process.stdout.write(JSON.stringify({ ask: k, params: 1 }) + "\n");
        break;
      }
      case "emit":
        process.stdout.write(JSON.stringify({ event: params.name, params: params.params }) + "\n");
        reply({ id, ok: true, value: null });
        break;
      case "strayask":
        process.stdout.write('{"ask":-1,"method":"x"}\n');
        reply({ id, ok: true, value: "after" });
        break;
      case "badutf8":
        process.stdout.write(Buffer.from([0xff, 0xfe, 0x0a]));
        reply({ id, ok: true, value: "after-bad" });
        break;
      default:
        reply({ id, ok: false, error: "unknown method: " + method });
    }
  });

  rl.on("close", () => {
    if (ignoreEof) {
      setInterval(() => {}, 1000);
    } else {
      process.exit(0);
    }
  });
}
