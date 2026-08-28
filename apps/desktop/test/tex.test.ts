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

import { compileTex, parseTexLog } from "../src/tex";

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

/** The smallest document that is actually a document. */
const MINIMAL = "\\documentclass{article}\n\\begin{document}\nHello.\n\\end{document}\n";

function fakeTool() {
  return { kind: "pdflatex", command: "pdflatex", version: "test" } as const;
}
