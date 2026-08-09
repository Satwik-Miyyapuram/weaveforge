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

    // Each asset is an independent download-then-upload pair. Copying them one
    // after another made duplicating an image-heavy note take as many serial
    // round trips as it had images; they do not depend on each other, so they
    // travel together. Rewrites are applied afterwards, in the body's own
    // order, so the result does not depend on which copy finished first.
    const copied = await Promise.all(
      paths.map(async (oldPath) => {
        try {
          const blob = await this.deps.assets.fetchDecrypted(oldPath);
          const ext = oldPath.split(".").pop() ?? "bin";
          return { oldPath, newPath: await this.deps.assets.upload(page.id, blob, ext) };
        } catch {
          return null;
        }
      }),
    );

    let body = source.body;
    for (const entry of copied) {
      if (!entry) continue;
      body = body.replaceAll(`vault:${entry.oldPath}`, `vault:${entry.newPath}`);
    }

    if (body !== source.body) {
      return this.deps.manageVaultPage.update(page.id, { body });
    }
    return page;
  }
}
