/**
 * Sends the vendored Overleaf IDE's server requests (`/project/...`, compiled
 * PDFs) through the desktop app's `http` route, which signs them in to Overleaf
 * with the stored session. Bodies travel as base64 because they may be binary.
 */
import type { Forward, ForwardResponse } from "@overleaf-ide";
import { post, type WorkshopClientDeps } from "./workshop-session-client";

export const WORKSHOP_HTTP_PATH = "/api/overleaf/workshop/http";

export function workshopHttpForward(deps: WorkshopClientDeps, sessionId: string, projectId: string): Forward {
  return async ({ method, url, headers, body }) => {
    const res = await post(deps, WORKSHOP_HTTP_PATH, {
      sessionId,
      projectId,
      method,
      url,
      headers,
      body: body ? toBase64(body) : null,
    });
    if (!res.ok) return failed(res.status === 401 && res.expired ? 401 : 502, res.message);
    const answer = res.body as { status?: unknown; headers?: unknown; body?: unknown };
    if (typeof answer.status !== "number") return failed(502, "Overleaf sent no answer.");
    return {
      status: answer.status,
      headers: isStringRecord(answer.headers) ? answer.headers : {},
      body: typeof answer.body === "string" ? fromBase64(answer.body) : new Uint8Array(),
    };
  };
}

function failed(status: number, message: string): ForwardResponse {
  return { status, headers: { "content-type": "text/plain" }, body: new TextEncoder().encode(message) };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === "object" && value !== null && Object.values(value).every((v) => typeof v === "string");
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  // In slices: spreading a whole PDF into one call overflows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
