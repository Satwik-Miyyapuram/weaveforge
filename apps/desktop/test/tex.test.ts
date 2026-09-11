/**
 * Compiling with the machine's own TeX.
 *
 * The engine itself is not installed on CI, so what is tested here is
 * everything around it: that a page cannot name a path outside the build
 * directory, that a missing TeX is an answer rather than a crash, and that the
 * log is turned into somewhere to click. A real compile is the smoke test's
 * job on a machine that has one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { argsFor, compileTex, parseTexLog } from "../src/tex";

test("tex: -file-line-error lines become a file, a line and a reason", () => {
  const errors = parseTexLog(
    ["./main.tex:12: Undefined control sequence.", "chapters/intro.tex:3: Missing $ inserted."].join("\n"),
    "main.tex",
  );

  assert.deepEqual(errors, [
    { file: "main.tex", line: 12, message: "Undefined control sequence." },
    { file: "chapters/intro.tex", line: 3, message: "Missing $ inserted." },
  ]);
});

test("tex: an engine that only says '!' still gets its line number", () => {
  const errors = parseTexLog(
    ["! LaTeX Error: File `missing.sty' not found.", "", "See the LaTeX manual.", "l.7 \\usepackage{missing}"].join(
      "\n",
    ),
    "main.tex",
  );

  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.line, 7);
  assert.match(errors[0]?.message ?? "", /File `missing\.sty' not found/);
});

test("tex: the same error reported twice is listed once", () => {
  const errors = parseTexLog("./main.tex:12: Undefined control sequence.\n./main.tex:12: Undefined control sequence.", "main.tex");

  assert.equal(errors.length, 1);
});

test("tex: a log with nothing wrong in it yields no errors", () => {
  assert.deepEqual(parseTexLog("This is pdfTeX\nOutput written on main.pdf (42 pages).", "main.tex"), []);
});

test("tex: a source path that leaves the build directory is refused", async () => {
  await assert.rejects(
    () => compileTex([{ path: "../escape.tex", content: "x" }], "main.tex", fakeTool()),
    /leaves the build directory/,
  );
  await assert.rejects(
    () => compileTex([{ path: "/etc/passwd", content: "x" }], "main.tex", fakeTool()),
    /leaves the build directory/,
  );
  await assert.rejects(() => compileTex([], "../main.tex", fakeTool()), /leaves the build directory/);
});

test("tex: a latexmk rc file in the sources is refused, it is a script", async () => {
  for (const path of [".latexmkrc", "latexmkrc", "sub/.LatexMkRc"]) {
    await assert.rejects(
      () => compileTex([{ path, content: "system('id')" }], "main.tex", fakeTool()),
      /run it as a script/,
    );
  }
});

test("tex: with no TeX installed the answer is a reason, not a failure", async () => {
  const result = await compileTex([{ path: "main.tex", content: MINIMAL }], "main.tex", null);

  // `null` means "look for one"; CI has none, so this is the no-TeX path.
  if (result.engine === null) {
    assert.equal(result.ok, false);
    assert.equal(result.pdf, null);
    assert.match(result.errors[0]?.message ?? "", /No TeX installation/);
  } else {
    // A developer machine with TeX on it: then it must actually have compiled.
    assert.equal(result.ok, true, result.log);
    assert.ok(result.pdf);
  }
});

test("tex: tectonic is asked to write the PDF, not to print it", () => {
  // The bug this pins down: `--print` sends the PDF to stdout instead of
  // writing it, and `compileTex` reads `<entry>.pdf` from the build directory.
  // So `ok` was false on every tectonic-only machine, and the promisified
  // `execFile` decoded the whole PDF as UTF-8 into the log the reader is shown.
  // It was invisible wherever `latexmk` exists, because that is probed first.
  const args = argsFor({ kind: "tectonic", command: "tectonic", version: "test" }, "main.tex");

  assert.equal(args.includes("--print"), false);
  // `--keep-logs` is what puts the `.log` `compileTex` reads next to the PDF.
  assert.ok(args.includes("--keep-logs"));
  // The `--` separator stays, so an entry file named `-something.tex` is a file
  // rather than an option.
  assert.deepEqual(args, ["--keep-logs", "--", "main.tex"]);
});

test("tex: no engine is asked for anything that writes outside its own directory", () => {
  const tool = (kind: "latexmk" | "tectonic" | "pdflatex") => ({ kind, command: kind, version: "t" });
  for (const kind of ["latexmk", "tectonic", "pdflatex"] as const) {
    const args = argsFor(tool(kind), "main.tex");
    assert.equal(args.some((arg) => arg.startsWith("--outdir") || arg === "-output-directory"), false, kind);
    assert.ok(args.some((arg) => arg.includes("main.tex")), kind);
  }
});

/** The smallest document that is actually a document. */
const MINIMAL = "\\documentclass{article}\n\\begin{document}\nHello.\n\\end{document}\n";

function fakeTool() {
  return { kind: "pdflatex", command: "pdflatex", version: "test" } as const;
}
