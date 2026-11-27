/** Where ink chunks live: the open folder, the encrypted bucket, or nowhere (desktop without a folder). */
import { BlobInkChunkStore, CopyOnReadInkChunkStore, FolderInkNotes, FsInkChunkStore, UnavailableInkChunkStore } from "@/features/ink/infrastructure/parts";
import { folderLock } from "@/features/workspace/application/folder-lock";
import { activeWorkspaceFs, folderRestored } from "@/features/workspace/application/workspace-folder";
import { desktop } from "@/lib/desktop/desktop-bridge";
import type { FetchingBlobStore } from "@/storage/fetching-blob-store";
import { inkChunkStoreFor, RoutedInkChunkStore, type wireBackend } from "@/container/parts";

export function wireInkChunkStore(encryptedBlobStore: FetchingBlobStore, session: ReturnType<typeof wireBackend>["session"]): RoutedInkChunkStore {
  // Ink chunks follow the page: in the folder beside the note's file
  // (`foo.note.md` -> `foo.note.ink/`, legacy `foo.ink.md` -> `foo.ink/`) when one is open, the encrypted asset bucket
  // otherwise (§4.1). Routed per call, since a folder can be chosen or
  // forgotten while the app is running.
  const inkNotes = new FolderInkNotes(activeWorkspaceFs, {
    run: (fn) => folderLock.run(fn),
  });
  const fsInkChunks = new FsInkChunkStore(activeWorkspaceFs, inkNotes, (fn) => folderLock.run(fn));
  const blobInkChunks = new BlobInkChunkStore(encryptedBlobStore, session);
  // On the desktop the folder is the only home: the bucket is read once per
  // page to migrate legacy ink (copy-on-read), and nothing is written to it.
  // Without a folder the desktop has nowhere for ink. The web is unchanged.
  const copyOnReadInkChunks = new CopyOnReadInkChunkStore(fsInkChunks, blobInkChunks);
  const unavailableInkChunks = new UnavailableInkChunkStore();
  const inkChunkStore = new RoutedInkChunkStore(
    () => {
      const onDesktop = desktop() !== null;
      return inkChunkStoreFor(
        { folderOpen: Boolean(activeWorkspaceFs()), desktop: onDesktop },
        {
          folder: onDesktop ? copyOnReadInkChunks : fsInkChunks,
          bucket: blobInkChunks,
          unavailable: unavailableInkChunks,
        },
      );
    },
    folderRestored,
  );
  return inkChunkStore;
}
