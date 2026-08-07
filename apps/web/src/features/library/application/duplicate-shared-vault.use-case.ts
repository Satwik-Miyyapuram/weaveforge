import type {
  IShareRepository,
  IVaultPageRepository,
  ManageVaultPageUseCase,
  VaultPage,
} from "@weaveforge/core";
import { LibraryPinError, shareCoversResource, vaultAssetPathsInBody } from "@weaveforge/core";
import type { IVaultAssetStore } from "@/features/vault/domain/vault-assets";

export class DuplicateSharedVaultPageUseCase {
  constructor(
    private readonly deps: {
      shares: IShareRepository;
      pages: IVaultPageRepository;
      manageVaultPage: ManageVaultPageUseCase;
      assets: IVaultAssetStore;
    },
  ) {}

  async execute(input: { resourceId: string; ownerId: string }): Promise<VaultPage> {
    const shares = await this.deps.shares.listSharedWithMe("vault_page");
    const allowed = shares.some((s) =>
      shareCoversResource(s, "vault_page", input.resourceId, input.ownerId),
    );
    if (!allowed) {
      throw new LibraryPinError("This vault page is not shared with you.");
    }

    const source = await this.deps.pages.getById(input.resourceId);
    if (!source) {
      throw new LibraryPinError("Vault page not found or not accessible.");
    }

    const page = await this.deps.manageVaultPage.add({
      title: `${source.title} (copy)`,
      body: source.body,
    });

    const paths = vaultAssetPathsInBody(source.body);
    if (paths.length === 0) return page;

    let body = source.body;
    for (const oldPath of paths) {
      try {
        const blob = await this.deps.assets.fetchDecrypted(oldPath);
        const ext = oldPath.split(".").pop() ?? "bin";
        const newPath = await this.deps.assets.upload(page.id, blob, ext);
        body = body.replaceAll(`vault:${oldPath}`, `vault:${newPath}`);
      } catch {
        continue;
      }
    }

    if (body !== source.body) {
      return this.deps.manageVaultPage.update(page.id, { body });
    }
    return page;
  }
}
