/**
 * The application log as the page sees it: report a line, read the log, show
 * the file. Moved out of `main.ts` with the comments it carried there.
 */
import { shell } from "electron";
import { MAX_ENTRIES, type AppLog, type AppLogEntry } from "./app-log";
import { CHANNELS, type AppLogPayload, type IpcResult } from "./channels";
import type { IpcSurface } from "./ipc-guard";

/**
 * One log entry as one line.
 *
 * The panel and the file show the same text, and the file's lines are the JSON
 * this produces, so the two can never disagree about what a record says. The
 * detail is appended rather than summarised: for a failed request it is the URL,
 * the status and the head of the body, which is the whole reason the log exists.
 */
function formatLogLine(entry: AppLogEntry): string {
  const stamp = entry.at.replace("T", " ").replace("Z", "");
  const head = `${stamp} ${entry.level.toUpperCase().padEnd(5)} [${entry.source}] ${entry.message}`;
  return entry.detail ? `${head}\n    ${entry.detail.replace(/\n/g, "\n    ")}` : head;
}

export function registerMainAppLog(deps: { ipc: IpcSurface; appLog: AppLog }): void {
  const { ipc, appLog } = deps;
  /**
   * The application log's three channels.
   *
   * `appReport` is a `send` from a page whose request just failed, so it is
   * validated here rather than trusted: a level outside the three, or a message
   * that is not a string, is dropped. It is not refused loudly — a malformed log
   * line is worth less than the failure the page was trying to report, and an
   * exception on the far side would replace that report with a bigger one.
   *
   * `appRead` formats here rather than in the page so there is one answer to what
   * a log line looks like: `text` is what the panel shows and what the file
   * holds, in the same order. `appReveal` opens the shell's own path and takes no
   * argument, so a page cannot ask the operating system to open anything else.
   */
  ipc.on(CHANNELS.appReport, (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object") return;
    const entry = payload as Record<string, unknown>;
    const level = entry.level;
    if (level !== "error" && level !== "warn" && level !== "info") return;
    if (typeof entry.message !== "string" || entry.message.length === 0) return;
    appLog.record({
      level,
      source: typeof entry.source === "string" ? entry.source : "renderer",
      message: entry.message,
      detail: typeof entry.detail === "string" ? entry.detail : undefined,
    });
  });
  
  /**
   * The log itself, in the envelope `call()` unwraps.
   *
   * That envelope is the whole reason this handler is shaped the way it is.
   * `preload.ts`'s `call()` reads `result.ok` before it reads anything else, so a
   * handler that answers with the payload directly — which is what nearly every
   * `ipcMain.handle` in this file does, because the two fetch channels predate the
   * envelope — makes the far side throw `new Error(undefined)`: a rejection with
   * no message, reported to the reader as a bare "Error". That is exactly what
   * this did on its first run. Every `call()`-wrapped channel answers with
   * `{ ok, value }`; `preferenceRead` and `localApiState` show the shape.
   */
  ipc.handle(CHANNELS.appRead, (): IpcResult<AppLogPayload> => {
    try {
      const entries = appLog.entries();
      return {
        ok: true,
        value: {
          file: appLog.file(),
          // One entry per line in the JSON file; these are formatted for a person,
          // so an entry with a detail spans several lines. The panel is not a
          // parser and does not need them to be one-to-one.
          text: entries.map(formatLogLine).join("\n"),
          // `false` means the ring has dropped something it once held. It is not
          // a claim about the file: the ring and the file hold different amounts
          // at different times, and this is the ring's own answer. That is why the
          // panel offers the file rather than promising what is in it.
          complete: entries.length < MAX_ENTRIES,
        },
      };
    } catch (cause) {
      // A failure here is the panel's problem to report, not the caller's to
      // decode: the message crosses as data, like every other refusal.
      return {
        ok: false,
        message: cause instanceof Error ? cause.message : String(cause),
      };
    }
  });
  
  /**
   * Show the log in the operating system's file browser.
   *
   * In the envelope, like `appRead` above — this shipped without it, and the
   * result was `revealAppLog()` rejecting with `TypeError: Cannot read properties
   * of null (reading 'ok')` for every click: `call()` dereferences `result.ok`
   * before it looks at anything else, and `null` has no `ok`. The button was dead
   * and the reason was invisible, which is the worst version of this class of bug.
   * It takes no argument, so a page cannot ask the shell to open anything but the
   * one file it chose.
   */
  ipc.handle(CHANNELS.appReveal, (): IpcResult<null> => {
    shell.showItemInFolder(appLog.file());
    return { ok: true, value: null };
  });
}
