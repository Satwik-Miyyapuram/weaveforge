"use client";

import { useSyncExternalStore } from "react";
import type { Peer } from "../domain/presence";
import { peersFor, subscribePeers } from "../application/presence-store";

const SHOWN = 4;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

/** Coloured initials, one per person, in the colour of their caret. */
export function PresenceAvatars({ peers }: { peers: readonly Peer[] }) {
  if (peers.length === 0) return null;
  const extra = peers.length - SHOWN;
  return (
    <span className="pane-peers" role="status" aria-label={`Also editing: ${peers.map((p) => p.name).join(", ")}`}>
      {peers.slice(0, SHOWN).map((peer) => (
        <span className="pane-peer" key={peer.key} title={peer.name} style={{ background: peer.color }}>
          {initials(peer.name)}
        </span>
      ))}
      {extra > 0 ? (
        <span className="pane-peer" title={peers.slice(SHOWN).map((p) => p.name).join(", ")}>
          +{extra}
        </span>
      ) : null}
    </span>
  );
}

/** Avatars for a document by its `<kind>:<id>` key; re-renders only itself. */
export function DocumentPresence({ docKey }: { docKey: string }) {
  const peers = useSyncExternalStore(subscribePeers, () => peersFor(docKey), () => peersFor(docKey));
  return <PresenceAvatars peers={peers} />;
}
