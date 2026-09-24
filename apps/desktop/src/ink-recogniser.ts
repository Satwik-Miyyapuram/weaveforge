/**
 * The Windows Ink recogniser, as the desktop app reaches it.
 *
 * A helper process over stdio rather than a native addon (§5.3): no Electron ABI
 * coupling, no rebuild per Electron bump, and a crash in the recogniser kills the
 * helper instead of the app. What that costs is this file — a child process, a
 * newline-delimited JSON protocol to keep stable, and a restart path.
 *
 * **The process is spawned once per session, not once per page.** Measured on the
 * target hardware (Snapdragon X, Windows 11 arm64, .NET 9), a cold start is
 * ~90–170 ms: that is the CLR and the Windows SDK loading, and paying it per page
 * would put a visible pause in front of every "Recognise" the user asks for. Warm,
 * a three-line page is ~30–50 ms. So the helper is started lazily, kept, and
 * restarted only if it dies.
 *
 * **stderr is never parsed.** This machine's .NET runtime prints
 * `unknown Qualcomm CPU part 0x1 ignored` to stderr on every start, and the
 * protocol lives on stdout. Anything read from stderr is diagnostic text for a log
 * line, never a message.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";

/** One line of writing: flat `[x, y, pressure, x, y, pressure, …]` per stroke. */
export interface InkRecognitionLineInput {
  strokes: number[][];
}

export interface InkRecognitionRequest {
  lines: readonly InkRecognitionLineInput[];
  /**
   * Words the note is likely to contain.
   *
   * Sent, and **ignored by this engine**: `InkAnalyzer` exposes no word-list
   * parameter, so the vocabulary is applied on the client, to the per-word
   * readings in `words` and in §5.4's post-match.
   */
  vocabulary?: readonly string[];
  lang?: string;
}

export interface InkRecognitionLine {
  text: string;
  /**
   * `1` when the engine produced text for the line and `0` when it did not.
   *
   * Not a measurement: `InkAnalyzer` exposes no confidence, and inventing one
   * would make the correction UI's dotted underline claim to know which lines are
   * doubtful. The evidence is in `words`, from which the client derives a score
   * (packages/core/src/ink/decode.ts).
   */
  confidence: number;
  alternatives?: string[];
  words?: InkRecognitionWord[];
}

/** One word's readings, the engine's pick first, with the OS spell checker's verdicts. */
export interface InkRecognitionWord {
  candidates: string[];
  /** Parallel to `candidates`; null when the machine has no dictionary for the language. */
  known: boolean[] | null;
  /** This word and the next read as one, when that reading is a word. */
  join: string | null;
}

export interface InkRecognitionResult {
  engine: string;
  lines: InkRecognitionLine[];
  /** The engine's own timing for the page, in milliseconds. */
  ms: number;
}

/**
 * One message to the pen's actuator (ink-native-bridges.md §4). `update` is sent
 * per sample during a stroke; the others once per tool change and pen lift.
 */
export type InkHapticsMessage =
  | { type: "tool"; tool: string }
  | { type: "update"; pressure: number; velocity: number }
  | { type: "stop" };

export interface InkRecogniserHelper {
  /** Whether a helper is present and has answered. Cached once true. */
  available(): Promise<boolean>;
  recognise(request: InkRecognitionRequest): Promise<InkRecognitionResult>;
  /**
   * Whether this OS can drive a haptic pen at all. Whether one is in the hand
   * is only known stroke by stroke, so a yes here means "worth sending".
   */
  hapticsAvailable(): Promise<boolean>;
  /**
   * Fire and forget: no answer comes back, and a helper that is not running is
   * not started for it — a stroke should never wait on a CLR cold start.
   */
  haptics(message: InkHapticsMessage): void;
  /** Release the process. The next call starts a new one. */
  dispose(): void;
  /** What the helper said about the machine, or `null` before it has spoken. */
  readonly version: string | null;
  /** Where the helper was looked for, for a settings panel or an error line. */
  readonly executable: string | null;
}

/** How long a page may take before the caller is told the helper is stuck. */
const REQUEST_TIMEOUT_MS = 15_000;

/** How long the ready line may take. Generous: it is a cold CLR start. */
const READY_TIMEOUT_MS = 30_000;

/**
 * Where the helper is, by platform and architecture.
 *
 * Two builds ship, because the app ships two: `win-arm64` and `win-x64`, since a
 * Windows on Arm machine can run an x64 build under emulation but should not have
 * to (§10). `extraResources` in the packaging config puts the right one at the
 * same relative path in a packaged install, so this function does not have to know
 * whether it is running from a checkout or from installation media — only which
 * directory is "resources", which Electron reports as `process.resourcesPath` and
 * which is the working directory in development.
 */
export function inkRecogniserPath(
  options: {
    platform?: NodeJS.Platform;
    arch?: string;
    resources?: string;
    root?: string;
  } = {},
): string | null {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return null;
  const arch = options.arch ?? process.arch;
  const rid = arch === "arm64" ? "win-arm64" : arch === "x64" ? "win-x64" : null;
  if (!rid) return null;
  const base =
    options.resources ??
    options.root ??
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ??
    process.cwd();
  return path.join(base, "native", "ink-recogniser", rid, "ink-recogniser.exe");
}

export interface InkRecogniserOptions {
  /** The helper executable, defaulting to {@link inkRecogniserPath}. */
  executable?: string | null;
  /** Injected for tests: the thing that starts a process. */
  spawnHelper?: (executable: string) => ChildProcessWithoutNullStreams;
  timeoutMs?: number;
  /** How long the ready line may take. Only shortened by tests. */
  readyTimeoutMs?: number;
  /** A line of diagnostics; the app's log, not the user's. */
  onDiagnostic?: (message: string) => void;
}

interface Pending {
  resolve: (result: InkRecognitionResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * One helper process, started on demand and kept.
 *
 * Requests are correlated by id rather than serialised, so a caller that fires two
 * pages at once — "recognise the whole note" — gets both answers as they come
 * rather than one after the other.
 */
export function createInkRecogniser(options: InkRecogniserOptions = {}): InkRecogniserHelper {
  const executable = options.executable === undefined ? inkRecogniserPath() : options.executable;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const readyTimeoutMs = options.readyTimeoutMs ?? READY_TIMEOUT_MS;
  const diagnose = options.onDiagnostic ?? (() => {});

  let child: ChildProcessWithoutNullStreams | null = null;
  let buffer = "";
  let nextId = 1;
  let version: string | null = null;
  let ready: Promise<boolean> | null = null;
  let disposed = false;
  let hapticsSupported: boolean | null = null;
  const pending = new Map<number, Pending>();

  /** Fail every request in flight, because the process they were sent to is gone. */
  const failAll = (reason: string): void => {
    for (const [id, waiter] of pending) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(reason));
      pending.delete(id);
    }
  };

  const handleLine = (line: string): void => {
    let message: {
      type?: string;
      id?: number;
      engine?: string;
      version?: string;
      message?: string;
      ms?: number;
      lines?: InkRecognitionLine[];
      available?: boolean;
    };
    try {
      message = JSON.parse(line);
    } catch {
      // A line that is not JSON is not part of the protocol, and guessing at it
      // would be worse than dropping it.
      diagnose(`ink-recogniser: unparseable line ${line.slice(0, 200)}`);
      return;
    }
    if (message.type === "ready") {
      version = message.version ?? null;
      if (message.id !== undefined) {
        const waiter = pending.get(message.id);
        if (waiter) {
          clearTimeout(waiter.timer);
          pending.delete(message.id);
          waiter.resolve({ engine: message.engine ?? "windows-ink@1", lines: [], ms: 0 });
        }
      }
      return;
    }
    if (message.id === undefined) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    clearTimeout(waiter.timer);
    pending.delete(message.id);
    if (message.type === "error") {
      waiter.reject(new Error(message.message ?? "The handwriting recogniser failed."));
      return;
    }
    if (message.type === "haptics") {
      hapticsSupported = message.available === true;
      waiter.resolve({ engine: message.engine ?? "windows-ink@1", lines: [], ms: 0 });
      return;
    }
    waiter.resolve({
      engine: message.engine ?? "windows-ink@1",
      lines: message.lines ?? [],
      ms: message.ms ?? 0,
    });
  };

  const start = (): ChildProcessWithoutNullStreams | null => {
    if (disposed) return null;
    if (child && !child.killed) return child;
    if (!executable) return null;
    const startProcess =
      options.spawnHelper ??
      ((target: string) =>
        spawn(target, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true }) as ChildProcessWithoutNullStreams);
    try {
      child = startProcess(executable);
    } catch (error) {
      diagnose(`ink-recogniser: could not start ${executable}: ${String(error)}`);
      child = null;
      return null;
    }

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let at = buffer.indexOf("\n");
      while (at >= 0) {
        const line = buffer.slice(0, at).trim();
        buffer = buffer.slice(at + 1);
        if (line) handleLine(line);
        at = buffer.indexOf("\n");
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      // Diagnostics only. The .NET runtime prints CPU-feature notices here on
      // every start on this hardware, and none of it is protocol.
      const text = String(chunk).trim();
      if (text) diagnose(`ink-recogniser: ${text}`);
    });
    child.on("exit", (code) => {
      // The helper exits with TerminateProcess(0) by design (see Program.cs), so a
      // nonzero code here is a real crash rather than the usual teardown.
      if (pending.size > 0) {
        failAll(
          code === 0 || code === null
            ? "The handwriting recogniser stopped before answering."
            : `The handwriting recogniser exited with ${code}.`,
        );
      }
      child = null;
      ready = null;
      version = null;
      hapticsSupported = null;
    });
    child.on("error", (error) => {
      diagnose(`ink-recogniser: ${error.message}`);
      failAll(error.message);
      child = null;
      ready = null;
    });
    return child;
  };

  const available = (): Promise<boolean> => {
    if (ready) return ready;
    const process_ = start();
    if (!process_) return Promise.resolve(false);
    ready = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        // No ready line in thirty seconds is a helper that is not going to work;
        // killing it means the next attempt starts clean rather than queueing
        // behind a stuck process.
        diagnose("ink-recogniser: no ready line; giving up on this helper");
        child?.kill();
        resolve(false);
      }, readyTimeoutMs);
      const onReady = () => {
        if (version === null) return;
        clearTimeout(timer);
        process_.stdout.off("data", onReady);
        resolve(true);
      };
      process_.stdout.on("data", onReady);
    });
    return ready;
  };

  const recognise = async (request: InkRecognitionRequest): Promise<InkRecognitionResult> => {
    if (!(await available())) throw new Error("The Windows handwriting recogniser is not available.");
    return ask({
      type: "recognise",
      lines: request.lines,
      vocabulary: request.vocabulary ? [...request.vocabulary] : undefined,
      lang: request.lang,
    });
  };

  /** One request with an answer, correlated by id. */
  const ask = (body: Record<string, unknown>): Promise<InkRecognitionResult> => {
    const process_ = start();
    if (!process_) return Promise.reject(new Error("The Windows handwriting recogniser is not available."));
    const id = nextId++;
    return new Promise<InkRecognitionResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("The handwriting recogniser did not answer in time."));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      process_.stdin.write(`${JSON.stringify({ id, ...body })}\n`);
    });
  };

  const hapticsAvailable = async (): Promise<boolean> => {
    if (hapticsSupported !== null) return hapticsSupported;
    if (!(await available())) return false;
    try {
      await ask({ type: "haptics-probe" });
    } catch {
      hapticsSupported = false;
    }
    return hapticsSupported ?? false;
  };

  const haptics = (message: InkHapticsMessage): void => {
    // Only to a helper that is up and has said yes: the pipe is not opened for
    // a sample, and a machine without the API gets nothing written at all.
    if (!hapticsSupported || !child || child.killed) return;
    const line =
      message.type === "update"
        ? { type: "haptics-update", pressure: message.pressure, velocity: message.velocity }
        : message.type === "tool"
          ? { type: "haptics-tool", tool: message.tool }
          : { type: "haptics-stop" };
    child.stdin.write(`${JSON.stringify(line)}\n`);
  };

  return {
    available,
    recognise,
    hapticsAvailable,
    haptics,
    dispose: () => {
      disposed = true;
      failAll("The handwriting recogniser was stopped.");
      child?.kill();
      child = null;
      ready = null;
    },
    get version() {
      return version;
    },
    get executable() {
      return executable;
    },
  };
}
