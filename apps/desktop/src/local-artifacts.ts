import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { contentTypeFor } from "./app-protocol";

/** `app://artifacts/{experimentId}/{uuid}/{name}`: SDK uploads kept on this disk. */
export const ARTIFACT_HOST = "artifacts";
export const ARTIFACT_URL_PREFIX = `app://${ARTIFACT_HOST}/`;

/** Matches the web route's 25 MB cap. */
export const MAX_LOCAL_ARTIFACT_BYTES = 25 * 1024 * 1024;

const SAFE_SEGMENT = /^[A-Za-z0-9._-]{1,128}$/;

export function isSafeSegment(value: unknown): value is string {
  return typeof value === "string" && SAFE_SEGMENT.test(value) && value !== "." && value !== "..";
}

export type SaveArtifact = (experimentId: string, name: string, bytes: Buffer) => Promise<string>;

/** Writes under `root` and returns the `app://artifacts/...` URL to record. */
export function localArtifactWriter(root: string): SaveArtifact {
  return async (experimentId, name, bytes) => {
    if (!isSafeSegment(experimentId) || !isSafeSegment(name)) throw new Error("Unsafe artifact path.");
    const id = randomUUID();
    const dir = path.join(root, experimentId, id);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, name), bytes);
    return `${ARTIFACT_URL_PREFIX}${experimentId}/${id}/${name}`;
  };
}

/** Serves one saved artifact; every segment is re-checked so a URL cannot leave `root`. */
export async function serveLocalArtifact(root: string, url: string): Promise<Response> {
  const segments = new URL(url).pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (segments.length !== 3 || !segments.every(isSafeSegment)) return new Response(null, { status: 404 });
  const file = path.join(root, ...segments);
  const bytes = await readFile(file).catch(() => null);
  if (!bytes) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "content-type": contentTypeFor(file), "x-content-type-options": "nosniff" },
  });
}
