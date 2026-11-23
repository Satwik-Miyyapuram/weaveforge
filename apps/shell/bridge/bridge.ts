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

const CHUNK = 0x8000;

/**
 * The data of a generated command's result; an error result is thrown as `Error(message)`,
 * with the shell's `code` on it when the error has one.
 */
export function unwrap<T>(
  result:
    | { status: "ok"; data: T }
    | { status: "error"; error: { message: string; code?: string | null } },
): T {
  if (result.status === "error") {
    const { message, code } = result.error;
    throw code ? Object.assign(new Error(message), { code }) : new Error(message);
  }
  return result.data;
}
