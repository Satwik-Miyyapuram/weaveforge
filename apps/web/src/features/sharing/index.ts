/** Public surface of the web `sharing` feature (infrastructure + UI). */
export { SupabaseShareRepository } from "./infrastructure/supabase-share-repository";
export { SupabaseCommentRepository } from "./infrastructure/supabase-comment-repository";
export { SupabaseSharedReader } from "./infrastructure/supabase-shared-reader";
export type { SharedItem, ISharedReader } from "./domain/shared-reader";
export { ShareButton } from "./ui/share-button";
export { CommentsToggle } from "./ui/comments-toggle";
export { SharedItemRenderer, PinnedPaperBadge } from "./ui/shared-item-renderer";
export { AddToLibraryButton } from "./ui/add-to-library-button";
export { usePinnedOwnerNames } from "./ui/use-pinned-owner-names";
export { DuplicateCopyButton } from "./ui/duplicate-copy-button";
