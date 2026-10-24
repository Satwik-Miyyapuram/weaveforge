/**
 * Best-effort localStorage. Blocked or missing storage (a private window, a
 * locked-down profile, the server) is not an error: a read gives null and a
 * write is dropped, so the setting lasts for this session only.
 */
export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Blocked storage: the setting lasts for this session only.
  }
}
