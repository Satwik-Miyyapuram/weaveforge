import type { LoadVaultScreenUseCase, VaultScreenData } from "@/features/vault/application/load-vault-screen.use-case";
import type { DuplicateSharedVaultPageUseCase } from "@/features/library/application/duplicate-shared-vault.use-case";

export class VaultFacade {
  constructor(
    private readonly deps: {
      load: LoadVaultScreenUseCase;
      pages: import("@weaveforge/core").IVaultPageRepository;
      manageVaultPage: import("@weaveforge/core").ManageVaultPageUseCase;
      assets: import("@/features/vault/domain/vault-assets").IVaultAssetStore;
      duplicateSharedPage: DuplicateSharedVaultPageUseCase;
    },
  ) {}

  loadScreenData(): Promise<VaultScreenData> {
    return this.deps.load.execute();
  }

  getPage(id: string) {
    return this.deps.pages.getById(id);
  }

  listPages() {
    return this.deps.pages.list();
  }

  get manageVaultPage() {
    return this.deps.manageVaultPage;
  }

  uploadAsset(pageId: string, blob: Blob, ext: string) {
    return this.deps.assets.upload(pageId, blob, ext);
  }

  signedAssetUrls(paths: string[]) {
    return this.deps.assets.signedUrls(paths);
  }

  fetchAssetBlob(path: string) {
    return this.deps.assets.fetchBlob(path);
  }

  fetchAssetBlobs(paths: readonly string[]) {
    return this.deps.assets.fetchBlobs(paths);
  }

  duplicateSharedPage(input: { resourceId: string; ownerId: string }) {
    return this.deps.duplicateSharedPage.execute(input);
  }
}
