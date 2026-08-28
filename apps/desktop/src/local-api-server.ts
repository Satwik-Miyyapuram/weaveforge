import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";

import { routeLocalRequest, type LocalApiRequest } from "./local-api";
import type { SemanticRanker } from "./local-mcp";
import type { SdkQuery } from "./local-sdk-api";
import type { VaultSession } from "./vault-handlers";

/**
 * The socket the local API listens on.
 *
 * Bound to `127.0.0.1` and never to `0.0.0.0`, in the code rather than in a
 * setting: a note-taking app that puts a writable file API on every interface
 * of a café network is a different and much worse product, and that is not a
 * decision to leave somewhere it can be changed by accident.
 *
 * The port matches `obsidian-local-rest-api`'s non-TLS port, because the
 * clients this exists for already look there.
 */
export const LOCAL_API_PORT = 27123;
export const LOCAL_API_HOST = "127.0.0.1";

/** A fresh token. 32 bytes: guessing is not a threat model this has to model. */
export function newLocalApiToken(): string {
  return randomBytes(32).toString("hex");
}

/** Bodies past this are refused rather than buffered. */
const MAX_BODY = 8 * 1024 * 1024;

export interface LocalApi {
  close(): Promise<void>;
}

/**
 * Start listening.
 *
 * `token()` is read per request rather than captured, so revoking a token
 * takes effect on the next request instead of on the next restart.
 *
 * `query` is what makes the Python SDK's routes answerable; omit it and this
 * serves the folder alone.
 */
export function startLocalApi(
  session: VaultSession,
  token: () => string,
  query?: SdkQuery,
  rank?: SemanticRanker,
): Promise<LocalApi> {
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let refused = false;

    req.on("data", (chunk: Buffer) => {
      if (refused) return; // Already answered; the rest of the upload is read and dropped.
      size += chunk.length;
      if (size > MAX_BODY) {
        // Marked here, refused once the upload is over.
        //
        // Every part of this was learned the hard way. Closing the socket
        // while the caller is still uploading resets the connection, and the
        // reset discards the response with it: the caller sees a connection
        // error rather than the 413 that explains itself. That is true
        // whether the socket is destroyed at once or on a short timer, so
        // the rest of the body is read and dropped, and the connection ends
        // by itself once the upload finishes. Nothing oversized is kept:
        // the buffer is released here, and no route runs for a refused request.
        refused = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (refused) {
        res.writeHead(413, { "content-type": "application/json" });
        res.end(JSON.stringify({ errorCode: 413, message: "That file is too large to accept." }));
        return;
      }
      const request: LocalApiRequest = {
        method: req.method ?? "GET",
        url: req.url ?? "/",
        authorization: req.headers.authorization,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      void routeLocalRequest(session, request, token(), query, rank)
        .then((answer) => {
          res.writeHead(answer.status, {
            "content-type": `${answer.contentType}; charset=utf-8`,
            // No browser page gets to call this, whatever it claims to be.
            // The clients this serves are local processes, and they do not
            // need CORS; a page that does is a page attacking the folder.
            "access-control-allow-origin": "null",
          });
          res.end(answer.body);
        })
        .catch(() => {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ errorCode: 500, message: "Something went wrong." }));
        });
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(LOCAL_API_PORT, LOCAL_API_HOST, () => {
      resolve({ close: () => new Promise((done) => server.close(() => done())) });
    });
  });
}
