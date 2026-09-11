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

/**
 * How long a refused upload may keep arriving before it is cut off.
 *
 * A refused request is still read to the end, and the next few paragraphs are
 * about why that is not laziness. What this bounds is the case that reasoning
 * does not cover: a caller that is not merely oversize but endless, dribbling
 * bytes for as long as it is allowed. Past this the connection is reset, which
 * loses the 413 -- on an upload that was not going to end, that is the better
 * of the two outcomes.
 */
const MAX_REFUSAL_DRAIN_MS = 30_000;

/**
 * Whether a request was addressed to this computer by name.
 *
 * A page can reach a loopback port through a DNS name it controls that
 * resolves to 127.0.0.1 after the browser has decided the page is trusted
 * (DNS rebinding). The `Host` header still says what the page typed, so a
 * request that arrived under any other name is not one meant for us.
 */
export function isLoopbackHost(host: string | undefined, port: number): boolean {
  const name = host?.trim().toLowerCase();
  return name === `127.0.0.1:${port}` || name === `localhost:${port}` || name === `[::1]:${port}`;
}

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
    if (!isLoopbackHost(req.headers.host, LOCAL_API_PORT)) {
      res.writeHead(421, { "content-type": "application/json" });
      res.end(JSON.stringify({ errorCode: 421, message: "Not for this host." }));
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let refused = false;
    let drainTimer: NodeJS.Timeout | undefined;

    /**
     * Mark the upload refused, release what was buffered, and start the meter.
     *
     * The flag is set here; the answer is written at `end`, and that separation
     * is the whole point of this function. Writing the 413 from inside this
     * handler looks better -- the caller is told as soon as there is something
     * to tell them -- and it does not work: answering while the request body is
     * still arriving makes Node destroy the socket once the reply is flushed,
     * because it cannot reuse a connection carrying unread request bytes. The
     * reset wipes the reply out of the client's receive buffer, so the caller
     * gets `ECONNRESET` instead of the explanation. Measured by the desktop
     * suite's two-piece upload at `test/local-api-server.test.ts`, which sends
     * the second half 100 ms after the first precisely so the refusal lands
     * mid-upload.
     *
     * So the body is drained to its end, and the 413 is written there. What is
     * new is only the bound: a caller that never finishes is reset after
     * `MAX_REFUSAL_DRAIN_MS` rather than holding the connection forever.
     */
    const refuse = () => {
      refused = true;
      chunks.length = 0; // Released here; the rest of the upload is dropped.
      drainTimer = setTimeout(() => req.destroy(), MAX_REFUSAL_DRAIN_MS);
      drainTimer.unref();
    };

    /**
     * Why the rest of a refused upload is still read and dropped.
     *
     * Closing the socket while the caller is still uploading is a reset, and a
     * reset discards everything already sitting in the client's receive buffer
     * -- the 413 included. That is not a theory: it was measured here against a
     * raw socket, and every variant of "answer, then stop reading" loses the
     * response. Answering first and destroying once the reply has flushed
     * (`res.once("finish")`) loses it too, because the response reaches the
     * kernel and the reset follows it inside the same connection; destroying on
     * a 50 ms or 250 ms delay after the flush loses it as well. The reset does
     * not merely race the reply, it erases it. Only draining to the end of the
     * request lets the 413 be delivered, because only then does the connection
     * close in the ordinary way, after both sides have finished.
     *
     * Answering early does not help either, and fails the same way for the same
     * reason -- see `refuse` above, which is why the answer is not written from
     * there.
     *
     * Nothing oversized is kept: the buffer is released as soon as the body is
     * refused, and no route runs for a refused request.
     */
    req.on("data", (chunk: Buffer) => {
      if (refused) return; // Already refused; the rest of the upload is dropped.
      size += chunk.length;
      if (size > MAX_BODY) {
        refuse();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (drainTimer) clearTimeout(drainTimer);
      if (refused) {
        // Written here rather than at the refusal, so the connection can close
        // in the ordinary way and the reply actually reaches the caller.
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
          // No CORS header at all, deliberately.
          //
          // The clients this serves are local processes -- the Python SDK, an
          // MCP server, someone's curl -- and none of them is a browser, so
          // none of them needs one. A header here would only ever be read by a
          // *page*, and the previous value was the worst of the three: "null"
          // permits exactly the opaque origins it looks like it is refusing,
          // so a sandboxed iframe on any site could read this folder's
          // responses. A browser page that needs CORS to reach this API is a
          // page attacking the folder; leaving the header off is what says so.
          res.writeHead(answer.status, {
            "content-type": `${answer.contentType}; charset=utf-8`,
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
