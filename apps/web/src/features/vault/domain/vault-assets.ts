export interface IVaultAssetStore {
  upload(pageId: string, blob: Blob, ext: string): Promise<string>;
  remove(path: string): Promise<void>;
  signedUrls(paths: string[]): Promise<(string | null)[]>;
  fetchBlob(path: string): Promise<Blob>;
  fetchBlobs(paths: readonly string[]): Promise<Map<string, Blob>>;
}
