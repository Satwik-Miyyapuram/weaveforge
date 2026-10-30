// Fake sidecar for the Rust client tests. Speaks the same line protocol as the real one.
import readline from "node:readline";

const ignoreEof = process.argv.includes("--ignore-eof");
const noRead = process.argv.includes("--no-read");

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
