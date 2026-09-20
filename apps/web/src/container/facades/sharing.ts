import type {
  CreateShareLinkUseCase,
  DuplicateSharedPaperUseCase,
  IExperimentRepository,
  ILibraryPinRepository,
  IMemberRepository,
  IPaperRepository,
  LibraryPin,
  ManageCommentsUseCase,
  ManageShareLinksUseCase,
  ManageSharingUseCase,
  NewLibraryPinInput,
  PinSharedResourceUseCase,
  RedeemShareLinkUseCase,
  RevokeShareLinkUseCase,
  Share,
  ShareableType,
} from "@weaveforge/core";
import type { ISharedReader } from "@/features/sharing/domain/shared-reader";
import type { LoadSharedWithMeScreenUseCase, LoadSharedWithMeScreenData } from "@/features/sharing/application/load-shared-with-me-screen.use-case";
import type { ICurrentUserProvider } from "@weaveforge/core";

export class SharingFacade {
  constructor(
    private readonly deps: {
      sharing: ManageSharingUseCase;
      comments: ManageCommentsUseCase;
      createShareLink: CreateShareLinkUseCase | null;
      redeemShareLink: RedeemShareLinkUseCase | null;
      manageShareLinks: ManageShareLinksUseCase | null;
      revokeShareLink: RevokeShareLinkUseCase | null;
      session: ICurrentUserProvider;
      sharedReader: ISharedReader;
      members: IMemberRepository;
      pinShared: PinSharedResourceUseCase;
      duplicateSharedPaper: DuplicateSharedPaperUseCase;
      libraryPins: ILibraryPinRepository;
      papers: IPaperRepository;
      experiments: IExperimentRepository;
      loadSharedWithMe: LoadSharedWithMeScreenUseCase;
    },
  ) {}

  shareLinksEnabled() {
    return this.deps.createShareLink != null;
  }

  async createShareLink(input: {
    resourceType: ShareableType;
    resourceId: string;
    expiresAt?: string | null;
  }) {
    if (!this.deps.createShareLink) throw new Error("Share links require Supabase backend.");
    const ownerId = await this.deps.session.requireUserId();
    return this.deps.createShareLink.execute({ ownerId, ...input });
  }

  async redeemShareLink(urlToken: string) {
    if (!this.deps.redeemShareLink) throw new Error("Share links require Supabase backend.");
    return this.deps.redeemShareLink.execute(urlToken);
  }

  listShareLinks(resourceType: ShareableType, resourceId: string) {
    if (!this.deps.manageShareLinks) return Promise.resolve([]);
    return this.deps.manageShareLinks.listForResource(resourceType, resourceId);
  }

  async revokeShareLink(input: { id: string; rotateDek?: boolean }) {
    if (!this.deps.revokeShareLink) throw new Error("Share links require Supabase backend.");
    const ownerId = await this.deps.session.requireUserId();
    return this.deps.revokeShareLink.execute({ ownerId, linkId: input.id, rotateDek: input.rotateDek });
  }

  get manageSharing() {
    return this.deps.sharing;
  }
  get manageComments() {
    return this.deps.comments;
  }
  get sharedReader() {
    return this.deps.sharedReader;
  }

  listDirectory() {
    return this.deps.members.listDirectory();
  }

  listSharedWithMe() {
    return this.deps.sharing.listSharedWithMe();
  }

  loadSharedWithMeScreen(): Promise<LoadSharedWithMeScreenData> {
    return this.deps.loadSharedWithMe.execute();
  }

  pinShared(input: NewLibraryPinInput): Promise<LibraryPin> {
    return this.deps.pinShared.execute(input);
  }

  duplicateSharedPaper(input: { resourceId: string; ownerId: string }) {
    return this.deps.duplicateSharedPaper.execute(input);
  }

  unpinShared(resourceType: ShareableType, resourceId: string) {
    return this.deps.libraryPins.unpin(resourceType, resourceId);
  }

  isPinned(resourceType: ShareableType, resourceId: string) {
    return this.deps.libraryPins.isPinned(resourceType, resourceId);
  }
}
