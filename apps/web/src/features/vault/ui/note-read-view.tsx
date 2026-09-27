"use client";

import dynamic from "next/dynamic";
import { isInkNoteBody } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { ImageSizeControl } from "@/components/image-size-control";
import { VaultMarkdown, type WikilinkEntry } from "./vault-markdown";

/**
 * The ink stack loads when a sheet is read, not with the notes screen: this
 * module reaches `/notes` through the vault barrel, and a static import put
 * the whole ink feature in that route's first load.
 */
const InkReader = dynamic(() => import("@/features/ink/ui/ink-reader").then((m) => m.InkReader), {
  ssr: false,
});

/**
 * A note, read: the one renderer for `/notes` and the Editor's Read mode.
 *
 * A note written in ink is read as the sheet it was written on (`InkReader`),
 * with every stroke, figure and page image; any other note is its markdown,
 * through `VaultMarkdown`, with the picture control that places an image from
 * the read view. The two screens used to draw a note separately — `/notes`
 * showed an ink note's recognised text and nothing else — and a note should
 * not look like two different things depending on where it was opened.
 */
export function NoteReadView({
  noteId,
  body,
  ink = isInkNoteBody(body),
  paperId = null,
  onSave,
  onClickCapture,
  notes = [],
  papers = [],
  sections = [],
  onCreateNote,
  resolveEmbed,
}: {
  noteId: string;
  body: string;
  /** Read as an ink sheet. Defaults to whether the body carries ink. */
  ink?: boolean;
  /** The paper a sheet belongs to, when it is a paper's Notes tab. */
  paperId?: string | null;
  /** Writes an image placement back. Absent where the note cannot be edited. */
  onSave?: (body: string) => Promise<void>;
  /** A host's own link handling, ahead of the renderer's. */
  onClickCapture?: (event: React.MouseEvent<HTMLDivElement>) => void;
  notes?: WikilinkEntry[];
  papers?: WikilinkEntry[];
  sections?: WikilinkEntry[];
  onCreateNote?: (title: string) => void;
  resolveEmbed?: (title: string) => string | null;
}) {
  if (ink) {
    return (
      <InkReader noteId={noteId} body={body} deps={getContainer().ink} paperId={paperId} />
    );
  }
  return (
    <div className="document-read" onClickCapture={onClickCapture}>
      <ImageSizeControl body={body} onSave={onSave}>
        <VaultMarkdown
          body={body}
          className="document-read-body"
          notes={notes}
          papers={papers}
          sections={sections}
          onCreateNote={onCreateNote}
          resolveEmbed={resolveEmbed}
        />
      </ImageSizeControl>
    </div>
  );
}
