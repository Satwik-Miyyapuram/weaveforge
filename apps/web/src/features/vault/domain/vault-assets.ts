export interface IVaultAssetStore {
  upload(pageId: string, blob: Blob, ext: string): Promise<string>;
  remove(path: string): Promise<void>;
  signedUrls(paths: string[]): Promise<(string | null)[]>;
  fetchDecrypted(path: string): Promise<Blob>;
  fetchDecryptedMany(paths: readonly string[]): Promise<Map<string, Blob>>;
}
