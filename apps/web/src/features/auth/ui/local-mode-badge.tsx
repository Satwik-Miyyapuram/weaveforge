"use client";

import { useEffect, useState } from "react";
import { isLocalMode } from "@/backend/providers/local/local-identity";

/**
 * Says, in the app itself, that this copy needs nothing from the network.
 *
 * Offline mode is otherwise invisible: the app looks the same whether it is
 * talking to a server or to the database on this disk, and "looks the same" is
 * exactly the wrong thing when the question is whether the app still works on a
 * train. Read after mount rather than during render, because the choice lives
 * in `localStorage` and the first render is also the server-rendered one.
 */
export function LocalModeBadge() {
  const [local, setLocal] = useState(false);
  useEffect(() => setLocal(isLocalMode()), []);
  if (!local) return null;
  return (
    <span className="local-mode-badge" title="Your data is on this computer. Nothing is sent anywhere, and no connection is needed.">
      Offline · on this computer
    </span>
  );
}
