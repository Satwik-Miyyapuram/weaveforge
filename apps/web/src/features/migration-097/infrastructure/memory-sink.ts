import type { FileSink } from "../domain/ports.ts";

/** In-memory FileSink. Used by tests and as the staging area for the zip download. */
export class MemorySink implements FileSink {
  private readonly files = new Map<string, Uint8Array>();

  async write(path: string, data: string | Uint8Array): Promise<void> {
    this.files.set(path, typeof data === "string" ? new TextEncoder().encode(data) : data.slice());
  }

  async list(): Promise<string[]> {
    return [...this.files.keys()];
  }

  async readText(path: string): Promise<string> {
    return new TextDecoder().decode(await this.readBytes(path));
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const bytes = this.files.get(path);
    if (!bytes) throw new Error(`missing file: ${path}`);
    return bytes;
  }

  async rename(from: string, to: string): Promise<void> {
    const bytes = await this.readBytes(from);
    this.files.delete(from);
    this.files.set(to, bytes);
  }
}
