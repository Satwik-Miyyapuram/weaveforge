/**
 * Compiling LaTeX with whatever TeX this machine already has.
 *
 * Overleaf's free tier stops a compile after a fixed number of seconds, which
 * is the one complaint about it that a thesis reliably runs into: the document
 * that times out is the finished one, with every figure in it. A machine with
 * a TeX installed has no such ceiling and no queue.
 *
 * What this file deliberately does not do is install one. A full TeX Live is
 * seven or eight gigabytes and even a minimal scheme is hundreds of megabytes,
 * against a desktop app of a couple of hundred in total — so the app ships no
 * TeX at all, finds one if it is there, and stays silent if it is not. A
 * missing TeX is a `null`, never an error: nobody asked for this feature by
 * installing the app.
 *
 * The compile happens in a temporary directory that is deleted afterwards.
 * Nothing is written next to the reader's own files, and the LaTeX being run is
 * whatever the page sent, never a path the page chose.
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * The engines worth trying, best first.
 *
 * `latexmk` wins because it decides how many passes the document needs,
 * including the bibliography ones — which is the whole difference between a
 * PDF with citations in it and a PDF full of question marks. `tectonic` is
 * self-contained and does the same job. Plain `pdflatex` is the fallback, and
 * it is a single pass, so cross-references may be one compile behind.
 */
const ENGINES = [
  { kind: "latexmk", command: "latexmk" },
  { kind: "tectonic", command: "tectonic" },
  { kind: "pdflatex", command: "pdflatex" },
] as const;

export type TexEngine = (typeof ENGINES)[number]["kind"];

export interface TexTool {
  kind: TexEngine;
  command: string;
  /** The first line of its `--version`, for the settings panel to show. */
  version: string;
}

export interface TexSourceFile {
  path: string;
  content: string;
}

export interface TexError {
  file: string;
  /** 1-based, or 0 when the engine did not say. */
  line: number;
  message: string;
}

export interface TexCompileResult {
  ok: boolean;
  /** The PDF, or null when the run produced none. */
  pdf: ArrayBuffer | null;
  /** The engine's log, trimmed to the end where the failure is. */
  log: string;
  errors: TexError[];
  engine: TexEngine | null;
}

/** Long enough for a thesis with every figure in it. */
const COMPILE_TIMEOUT_MS = 300_000;
const PROBE_TIMEOUT_MS = 10_000;
const MAX_LOG_CHARS = 200_000;
const MAX_TOTAL_BYTES = 40_000_000;
const MAX_FILES = 500;

/**
 * A path that stays inside the directory we made.
 *
 * The page names these, and a page that could name `../../.ssh/config` would be
 * choosing where the shell writes. Absolute paths, traversal and Windows drive
 * letters are all refused rather than normalised, because a caller with a
 * reason to send one does not exist.
 */
function safeRelative(candidate: string): string {
  const normalized = candidate.replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split("/").some((part) => part === ".." || part === "")
  ) {
    throw new Error(`Refusing to write '${candidate}': it leaves the build directory.`);
  }
  return normalized;
}

/** Ask one engine for its version. A missing binary answers null, not a throw. */
async function probeOne(engine: (typeof ENGINES)[number]): Promise<TexTool | null> {
  try {
    const { stdout, stderr } = await run(engine.command, ["--version"], {
      timeout: PROBE_TIMEOUT_MS,
      windowsHide: true,
    });
    const first = `${stdout || stderr}`.split("\n")[0]?.trim() ?? "";
    return { kind: engine.kind, command: engine.command, version: first || engine.kind };
  } catch {
    return null;
  }
}

/**
 * The best TeX on this machine, or null.
 *
 * Answered fresh each time rather than cached: somebody installing TeX Live
 * while the app is open should not have to restart it to be believed.
 */
export async function probeTex(): Promise<TexTool | null> {
  for (const engine of ENGINES) {
    const found = await probeOne(engine);
    if (found) return found;
  }
  return null;
}

function argsFor(tool: TexTool, entry: string): string[] {
  switch (tool.kind) {
    case "latexmk":
      return ["-pdf", "-interaction=nonstopmode", "-halt-on-error", "-file-line-error", entry];
    case "tectonic":
      return ["--keep-logs", "--print", entry];
    case "pdflatex":
      return ["-interaction=nonstopmode", "-halt-on-error", "-file-line-error", entry];
  }
}

/**
 * The errors out of a TeX log.
 *
 * Two shapes, because the engines disagree. `-file-line-error` gives
 * `./main.tex:12: Undefined control sequence`, which is the useful one. Without
 * it — and tectonic does not offer it — an error is a line starting `!`, with
 * the line number arriving separately on a later line beginning `l.12`.
 */
export function parseTexLog(log: string, entry: string): TexError[] {
  const errors: TexError[] = [];
  const lines = log.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    const located = /^(?:\.\/)?([^\s:][^:]*):(\d+):\s*(.+)$/.exec(line);
    if (located) {
      errors.push({
        file: (located[1] as string).replace(/^\.\//, ""),
        line: Number(located[2]),
        message: (located[3] as string).trim(),
      });
      continue;
    }
    if (!line.startsWith("!")) continue;
    const message = line.slice(1).trim();
    if (!message) continue;
    // The line number, when it comes, is within a handful of lines.
    let at = 0;
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j += 1) {
      const numbered = /^l\.(\d+)/.exec(lines[j] as string);
      if (numbered) {
        at = Number(numbered[1]);
        break;
      }
    }
    errors.push({ file: entry, line: at, message });
  }
  // One report per place: a run that halts prints the same error to the log
  // and to stdout, and the reader is being given a list to work through.
  const seen = new Set<string>();
  return errors.filter((error) => {
    const at = `${error.file}:${error.line}:${error.message}`;
    if (seen.has(at)) return false;
    seen.add(at);
    return true;
  });
}

async function writeSources(root: string, files: readonly TexSourceFile[]): Promise<void> {
  if (files.length > MAX_FILES) throw new Error("That project has too many files to compile here.");
  let total = 0;
  for (const file of files) {
    total += Buffer.byteLength(file.content, "utf8");
    if (total > MAX_TOTAL_BYTES) throw new Error("That project is too large to compile here.");
    const at = path.join(root, safeRelative(file.path));
    await fs.mkdir(path.dirname(at), { recursive: true });
    await fs.writeFile(at, file.content, "utf8");
  }
}

/** The end of the log, which is where a failure explains itself. */
function tail(text: string): string {
  return text.length <= MAX_LOG_CHARS ? text : text.slice(text.length - MAX_LOG_CHARS);
}

/**
 * Compile one project and answer the PDF or the reasons there is none.
 *
 * A failed compile is a result, not an exception: the log is the thing the
 * reader needs, and throwing it away to raise an error would leave them with
 * "compilation failed" and nothing to act on.
 */
export async function compileTex(
  files: readonly TexSourceFile[],
  entryFile: string,
  tool?: TexTool | null,
): Promise<TexCompileResult> {
  const engine = tool ?? (await probeTex());
  if (!engine) {
    return {
      ok: false,
      pdf: null,
      log: "",
      errors: [{ file: entryFile, line: 0, message: "No TeX installation was found on this computer." }],
      engine: null,
    };
  }

  const entry = safeRelative(entryFile);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "weaveforge-tex-"));
  try {
    await writeSources(root, files);

    let output = "";
    let failed = false;
    try {
      const { stdout, stderr } = await run(engine.command, argsFor(engine, entry), {
        cwd: root,
        timeout: COMPILE_TIMEOUT_MS,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
      });
      output = `${stdout}\n${stderr}`;
    } catch (error) {
      failed = true;
      const shell = error as { stdout?: string; stderr?: string; message?: string };
      output = `${shell.stdout ?? ""}\n${shell.stderr ?? shell.message ?? ""}`;
    }

    // The log file says more than stdout does, and tectonic writes little else.
    const logPath = path.join(root, entry.replace(/\.tex$/i, "") + ".log");
    const fileLog = await fs.readFile(logPath, "utf8").catch(() => "");
    const log = tail(`${fileLog}\n${output}`.trim());

    const pdfPath = path.join(root, entry.replace(/\.tex$/i, "") + ".pdf");
    const bytes = await fs.readFile(pdfPath).catch(() => null);
    const errors = parseTexLog(log, entry);

    return {
      ok: Boolean(bytes) && !failed,
      pdf: bytes ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : null,
      log,
      // A run that failed with nothing parseable still owes the reader a reason.
      errors:
        errors.length || !failed
          ? errors
          : [{ file: entry, line: 0, message: "The compile failed; the log below is the whole of it." }],
      engine: engine.kind,
    };
  } finally {
    await fs.rm(root, { recursive: true, force: true }).catch(() => {});
  }
}
