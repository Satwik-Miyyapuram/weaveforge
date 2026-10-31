import { errorMessage } from "@weaveforge/core";
import type { LocalDbHost } from "../../../desktop/src/local-db-host";
import { registerMainLocalApi } from "../../../desktop/src/main-local-api";
import { mcpLaunch, mcpPaths } from "../../../desktop/src/mcp-connect";
import { mcpClientConfigs, rewriteMcpClientConfigs } from "../../../desktop/src/mcp-rewrite";
import { sidecarApiDeps, type Handler } from "./api-deps";
import type { Handlers, Peer } from "./wire";

/** What the sidecar's local API needs from main: the shell peer, the database and the paths. */
export interface LocalApiStartOptions {
  peer: Pick<Peer, "ask" | "emit">;
  localDb: LocalDbHost;
  artifactRoot: string;
  /** The bundled MCP bridge script; without it the startup resume and the config rewrite are skipped. */
  bridge?: string;
  version: string;
  homeVariant?: string;
  home: string;
  platform: NodeJS.Platform;
  appData: string | undefined;
  execPath: string;
  log(line: string): void;
}

/** The started local API. */
export interface LocalApiStart {
  /** The base handlers plus the local API's. */
  handlers: Handlers;
  /** Settles when the door and the MCP rewrite have run; never rejects. */
  ready: Promise<void>;
  /** Closes the door. Never rejects. */
  close(): Promise<void>;
}

/**
 * Merges the local API's handlers into `base` and starts the door in the background.
 * Throws only when a handler name is registered twice. A dev build (`homeVariant`
 * set) never rewrites editors' MCP configs.
 */
export function startLocalApi(base: Handlers, o: LocalApiStartOptions): LocalApiStart {
  const paths = mcpPaths(o.home, o.homeVariant, o.bridge ?? "");
  const { deps, handlers: apiHandlers } = sidecarApiDeps({
    peer: o.peer,
    localDb: o.localDb,
    artifactRoot: o.artifactRoot,
    mcpPaths: paths,
    execPath: o.execPath,
    version: o.version,
  });
  // Registers the `ipc:` handlers into `apiHandlers`, so it runs before the merge.
  const api = registerMainLocalApi(deps);
  const handlers: Record<string, Handler> = { ...base };
  for (const [name, handler] of Object.entries(apiHandlers)) {
    // A name clash would silently replace a handler, so refuse it before anything starts.
    if (Object.hasOwn(handlers, name)) throw new Error(`handler ${name} registered twice`);
    handlers[name] = handler;
  }

  // Set by `close`; a `resume` that finishes after it is closed again.
  let closing = false;
  // Not awaited here: asks are only answered once `serve` reads stdin.
  const ready = (async () => {
    // An editor entry without the bridge would point at nothing, so skip the startup resume and the
    // rewrite. A later toggle can still open the door; refusing it is a plan §10 item.
    if (o.bridge === undefined || o.bridge === "") {
      o.log("[local-api] not started: no --bridge");
      return;
    }
    try {
      // As Electron's main: opens the port only when the preference is on and a token is live.
      await api.resume();
      if (closing) await api.close();
    } catch (e) {
      o.log("[local-api] " + errorMessage(e));
    }
    if (closing) return;
    // Dev builds keep their own editor entries; only the installed app moves them.
    if (o.homeVariant !== undefined) return;
    try {
      const { changed, skipped } = await rewriteMcpClientConfigs(
        mcpClientConfigs(o.home, o.platform, o.appData),
        mcpLaunch(paths, o.execPath, false),
      );
      if (changed.length > 0) o.log(`[mcp] moved editor entries: ${changed.join(", ")}`);
      if (skipped.length > 0) o.log(`[mcp] could not update (left as is): ${skipped.join(", ")}`);
    } catch (e) {
      o.log(`[mcp] rewrite failed: ${errorMessage(e)}`);
    }
  })();

  // Never awaits `ready`: its asks go unanswered once `serve` has ended.
  const close = async (): Promise<void> => {
    closing = true;
    try {
      await api.close();
    } catch (e) {
      o.log(`[local-api] close failed: ${errorMessage(e)}`);
    }
  };

  return { handlers, ready, close };
}
