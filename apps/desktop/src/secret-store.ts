import type { IpcResult } from "./channels";

/**
 * The one credential store the shell offers the page, and why it exists.
 *
 * In a browser the AI provider key is held in memory and nowhere else
 * (`ai-provider-session.ts` says so at length): writing it to localStorage
 * would turn a credential the reader controls into one this app stores,
 * readable by anything that can reach the origin's storage. That reasoning is
 * about a browser, and it does not carry over unchanged to an installed app —
 * here there is a keychain, the operating system holds the key, and what lands
 * on disk is a blob no other user account can decrypt.
 *
 * So the desktop build may remember it, on two conditions this file enforces:
 *
 *   1. **Only through the OS.** If `safeStorage` reports no backend — a Linux
 *      session with no keyring unlocked is the usual case — the write is
 *      refused. It does not fall back to plaintext, base64, or a key baked into
 *      the bundle, all of which would be storage we manage wearing a disguise.
 *   2. **Only names we know.** The page names the secret, and a page is
 *      whatever the server served; an open-ended keyed store would be a
 *      general-purpose disk the renderer could fill. The allow list is here.
 *
 * Everything Electron-shaped is injected, so this is testable without an app.
 */

/** The subset of Electron's `safeStorage` this needs. */
export interface SecretCrypto {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/** Where the encrypted blobs live, as bytes in and bytes out. */
export interface SecretFile {
  read(): Promise<string | null>;
  write(contents: string): Promise<void>;
}

/**
 * The secrets a page may name.
 *
 * Two today. Adding one is a deliberate act with a review attached,
 * which is the entire point of the list being short and here.
 */
export const SECRET_NAMES = ["ai-provider", "local-api-token"] as const;
export type SecretName = (typeof SECRET_NAMES)[number];

const UNKNOWN_NAME = "That is not something this app stores.";
const NO_KEYCHAIN =
  "This machine has no keychain available, so there is nowhere safe to keep it. " +
  "It stays in memory for this session.";

export function isSecretName(name: unknown): name is SecretName {
  return typeof name === "string" && (SECRET_NAMES as readonly string[]).includes(name);
}

export class SecretStore {
  constructor(
    private readonly crypto: SecretCrypto,
    private readonly file: SecretFile,
  ) {}

  async read(name: unknown): Promise<IpcResult<string | null>> {
    if (!isSecretName(name)) return { ok: false, message: UNKNOWN_NAME };
    // A machine that cannot encrypt cannot have written anything either, so
    // this is "nothing stored" rather than a failure. The renderer asks on
    // every load and a red banner at launch would be the wrong answer.
    if (!this.crypto.isEncryptionAvailable()) return { ok: true, value: null };

    const stored = await this.load();
    const blob = stored[name];
    if (typeof blob !== "string") return { ok: true, value: null };
    try {
      return { ok: true, value: this.crypto.decryptString(Buffer.from(blob, "base64")) };
    } catch {
      // A blob written by another OS user, or after a keychain reset. Treated
      // as absent rather than as an error: the reader's recourse is to type
      // the key again, which is exactly what "nothing stored" prompts.
      return { ok: true, value: null };
    }
  }

  async write(name: unknown, value: unknown): Promise<IpcResult<null>> {
    if (!isSecretName(name)) return { ok: false, message: UNKNOWN_NAME };
    if (typeof value !== "string" || !value) return { ok: false, message: UNKNOWN_NAME };
    if (!this.crypto.isEncryptionAvailable()) return { ok: false, message: NO_KEYCHAIN };

    const stored = await this.load();
    stored[name] = this.crypto.encryptString(value).toString("base64");
    await this.file.write(JSON.stringify(stored));
    return { ok: true, value: null };
  }

  async clear(name: unknown): Promise<IpcResult<null>> {
    if (!isSecretName(name)) return { ok: false, message: UNKNOWN_NAME };
    const stored = await this.load();
    // Deleted whether or not encryption is available: forgetting must work on
    // a machine where remembering never did.
    if (!(name in stored)) return { ok: true, value: null };
    delete stored[name];
    await this.file.write(JSON.stringify(stored));
    return { ok: true, value: null };
  }

  /**
   * What is on disk, as a plain record.
   *
   * Anything unreadable — missing file, truncated write, someone's editor —
   * reads as empty. The file holds nothing that cannot be re-entered, so
   * starting over is always a safe answer and never loses work.
   */
  private async load(): Promise<Record<string, unknown>> {
    const contents = await this.file.read();
    if (!contents) return {};
    try {
      const parsed: unknown = JSON.parse(contents);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}
