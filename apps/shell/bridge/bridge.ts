import type { DesktopBridge } from "@/lib/desktop/desktop-bridge";
import type { commands } from "./bindings";

/** The generated commands this part of the shim calls. */
export type LocalDbCommands = Pick<
  typeof commands,
  "dbQuery" | "dbState" | "dbReset"
>;

/** The local database part of `window.weaveforge`. */
export type LocalDbBridge = Pick<
  DesktopBridge,
  "queryLocalDb" | "localDbState" | "resetLocalDb"
>;

/** Wraps the generated commands as the local database part of `DesktopBridge`. */
export function localDbBridge(cmds: LocalDbCommands): LocalDbBridge {
  return {
    queryLocalDb: async (sql, params = []) =>
      decodeWire(
        unwrap(await cmds.dbQuery(sql, params.map(encodeParam))),
      ) as unknown[],
    localDbState: async () => unwrap(await cmds.dbState()),
    resetLocalDb: async () => {
      unwrap(await cmds.dbReset());
    },
  };
}

/** Base64 of `bytes`, without Buffer. Encodes in chunks so large values do not overflow the call stack. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** The bytes of a base64 string, without Buffer. */
export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** A query parameter as it goes on the wire: Uint8Array becomes {$bytes}, everything else is unchanged. */
export function encodeParam(
  value: string | number | boolean | null | Uint8Array,
): unknown {
  return value instanceof Uint8Array ? { $bytes: toBase64(value) } : value;
}

/** Decodes $bytes and $bigint tags anywhere in a reply: arrays and plain objects are walked, tags replaced. */
export function decodeWire(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeWire);
  if (!isPlainObject(value)) return value;
  const keys = Object.keys(value);
  if (keys.length === 1) {
    const [key] = keys;
    const text = value[key!];
    // Same tag rule as the sidecar's decodeValue, so the two sides agree on what a tag is.
    if (key === "$bytes" && typeof text === "string") return fromBase64(text);
    if (key === "$bigint" && typeof text === "string" && /^-?\d+$/.test(text))
      return BigInt(text);
  }
  return Object.fromEntries(keys.map((k) => [k, decodeWire(value[k])]));
}

const CHUNK = 0x8000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function unwrap<T>(
  result:
    { status: "ok"; data: T } | { status: "error"; error: { message: string } },
): T {
  if (result.status === "error") throw new Error(result.error.message);
  return result.data;
}
