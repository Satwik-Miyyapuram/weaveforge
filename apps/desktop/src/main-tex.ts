/** Compiling a LaTeX project the page hands over, in a directory of its own. */
import { CHANNELS } from "./channels";
import type { IpcSurface } from "./ipc-guard";
import { compileTex, type TexSourceFile } from "./tex";

export function registerMainTex(deps: { ipc: IpcSurface }): void {
  const { ipc } = deps;
  ipc.handle(
    CHANNELS.texCompile,
    async (_event, files: unknown, entryFile: unknown) => {
      // The page names the files; `compileTex` refuses any path that would leave
      // the temporary directory it makes, so nothing here is written near the
      // reader's own work.
      if (!Array.isArray(files) || typeof entryFile !== "string") {
        return { ok: false, message: "That is not a project to compile." };
      }
      try {
        return {
          ok: true,
          value: await compileTex(files as TexSourceFile[], entryFile),
        };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Error
              ? error.message
              : "The compile could not be started.",
        };
      }
    },
  );
}
