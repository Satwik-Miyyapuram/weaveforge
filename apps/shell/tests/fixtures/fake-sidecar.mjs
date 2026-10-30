// Fake sidecar for the Rust client tests. Speaks the same line protocol as the real one.
import readline from "node:readline";

const ignoreEof = process.argv.includes("--ignore-eof");
const noRead = process.argv.includes("--no-read");
const badState = process.argv.includes("--bad-state");
const slowState = process.argv.includes("--slow-state");

function reply(r) {
  process.stdout.write(JSON.stringify(r) + "\n");
}

process.stderr.write("ready\n");

if (noRead) {
  // Never reads stdin, so the client's writes back up into the pipe.
  setInterval(() => {}, 1000);
} else {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

  rl.on("line", (line) => {
    const { id, method, params } = JSON.parse(line);
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
        if (params.sql === "fail") {
          reply({ id, ok: false, error: "relation missing" });
        } else if (params.sql === "scalar") {
          reply({ id, ok: true, value: 5 });
        } else {
          reply({ id, ok: true, value: [{ sql: params.sql, params: params.params }] });
        }
        break;
      case "state": {
        const send = () => reply({ id, ok: true, value: { failure: null, dataDir: "/fake", restoredFrom: null } });
        if (badState) {
          reply({ id, ok: true, value: 42 });
        } else if (slowState) {
          setTimeout(send, 1000);
        } else {
          send();
        }
        break;
      }
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
