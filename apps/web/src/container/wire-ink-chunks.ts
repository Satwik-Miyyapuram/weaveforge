import { RoutedInkChunkStore, inkChunkStoreFor } from "@/container/parts";
import {
  BlobInkChunkStore,
  CopyOnReadInkChunkStore,
  FolderInkNotes,
  FsInkChunkStore,
  UnavailableInkChunkStore,
} from "@/features/ink/infrastructure/parts";
import { folderLock } from "@/features/workspace/application/folder-lock";
import { activeWorkspaceFs, folderRestored, syncToFolder } from "@/features/workspace/application/workspace-folder";
import { desktop } from "@/lib/desktop/desktop-bridge";

type BlobDeps = ConstructorParameters<typeof BlobInkChunkStore>;

/**
 * Ink chunks follow the page: in the folder beside the note's file
 * (`foo.note.md` -> `foo.note.ink/`, legacy `foo.ink.md` -> `foo.ink/`) when one is open, the encrypted asset bucket
 * otherwise (§4.1). Routed per call, since a folder can be chosen or
 * forgotten while the app is running.
 */
export function wireInkChunks(blobs: BlobDeps[0], session: BlobDeps[1]): RoutedInkChunkStore {
  const inkNotes = new FolderInkNotes(activeWorkspaceFs, {
    run: (fn) => folderLock.run(fn),
    syncFolder: syncToFolder,
  });
  const fsInkChunks = new FsInkChunkStore(activeWorkspaceFs, inkNotes, (fn) => folderLock.run(fn));
  const blobInkChunks = new BlobInkChunkStore(blobs, session);
  // On the desktop the folder is the only home: the bucket is read once per
  // page to migrate legacy ink (copy-on-read), and nothing is written to it.
  // Without a folder the desktop has nowhere for ink. The web is unchanged.
  const copyOnReadInkChunks = new CopyOnReadInkChunkStore(fsInkChunks, blobInkChunks);
  const unavailableInkChunks = new UnavailableInkChunkStore();
  return new RoutedInkChunkStore(
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
}
