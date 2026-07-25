"use client";

import type { ComponentProps } from "react";
import dynamic from "next/dynamic";
import type { CollabBodyHost as CollabBodyHostType } from "./collab-body-host";

type Props = ComponentProps<typeof CollabBodyHostType>;

/**
 * Lazy boundary for the collaborative editor. Yjs + y-codemirror + CodeMirror
 * are heavy and only needed once the user edits an entry, so they are split out
 * of the screen's first-load bundle and fetched on first use.
 */
const LazyCollabBodyHost = dynamic(
  () => import("./collab-body-host").then((m) => m.CollabBodyHost),
  {
    ssr: false,
    loading: () => (
      <div className="vault-body-input markdown-code-editor--loading" aria-busy="true">
        Loading editor…
      </div>
    ),
  },
);

export function CollabBodyHost(props: Props) {
  return <LazyCollabBodyHost {...props} />;
}
