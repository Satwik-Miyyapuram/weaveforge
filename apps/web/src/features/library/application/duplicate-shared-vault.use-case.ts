import type {
  IShareRepository,
  IVaultPageRepository,
  ManageVaultPageUseCase,
  VaultPage,
} from "@weaveforge/core";
import { LibraryPinError, shareCoversResource, vaultAssetPathsInBody } from "@weaveforge/core";
import type { IVaultAssetStore } from "@/features/vault/domain/vault-assets";
import { logToApp } from "@/lib/error-report/app-log";

/** The copy, and the images it still borrows from the owner because they could not be copied. */
export interface DuplicatedVaultPage {
  page: VaultPage;
  failedAssets: string[];
}

export class DuplicateSharedVaultPageUseCase {
  constructor(
    private readonly deps: {
      shares: IShareRepository;
      pages: IVaultPageRepository;
      manageVaultPage: ManageVaultPageUseCase;
      assets: IVaultAssetStore;
    },
  ) {}

  async execute(input: { resourceId: string; ownerId: string }): Promise<DuplicatedVaultPage> {
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
    if (paths.length === 0) return { page, failedAssets: [] };

    // Each asset is an independent download-then-upload pair. Copying them one
    // after another made duplicating an image-heavy note take as many serial
    // round trips as it had images; they do not depend on each other, so they
    // travel together. Rewrites are applied afterwards, in the body's own
    // order, so the result does not depend on which copy finished first.
    const copied = await Promise.all(
      paths.map(async (oldPath) => {
        try {
          const blob = await this.deps.assets.fetchBlob(oldPath);
          const ext = oldPath.split(".").pop() ?? "bin";
          return { oldPath, newPath: await this.deps.assets.upload(page.id, blob, ext) };
        } catch (err) {
          logToApp({
            level: "warn",
            source: "vault",
            message: `An image in the shared note could not be copied: ${oldPath}`,
            detail: String(err),
          });
          return { oldPath, newPath: null };
        }
      }),
    );
    const failedAssets = copied.filter((c) => c.newPath === null).map((c) => c.oldPath);

    let body = source.body;
    for (const entry of copied) {
      if (entry.newPath === null) continue;
      body = body.replaceAll(`vault:${entry.oldPath}`, `vault:${entry.newPath}`);
    }

    if (body !== source.body) {
      return { page: await this.deps.manageVaultPage.update(page.id, { body }), failedAssets };
    }
    return { page, failedAssets };
  }
}
