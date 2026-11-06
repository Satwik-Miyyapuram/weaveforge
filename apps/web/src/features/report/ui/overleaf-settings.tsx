"use client";

import { useState } from "react";
import { Button } from "@/components/button";
import { filterOverleafProjects, type OverleafProjectRow } from "../lib/overleaf-project-list";
import type { WorkshopSession } from "./use-workshop-session";

/**
 * The Overleaf tab's settings: the signed-in account (Disconnect) and which of
 * its projects the list shows. Linked projects always show, so they are not offered.
 */
export function OverleafSettings({
  session,
  accountRows,
  picked,
  onPick,
  onClose,
}: {
  session: WorkshopSession;
  /** The account's projects that are not linked. */
  accountRows: readonly OverleafProjectRow[];
  /** The chosen ids; null shows all. */
  picked: ReadonlySet<string> | null;
  onPick: (next: Set<string> | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const shown = filterOverleafProjects(accountRows, query);
  const isOn = (id: string) => picked === null || picked.has(id);
  const toggle = (id: string) => {
    const next = new Set(picked ?? accountRows.map((r) => r.id));
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onPick(next);
  };

  return (
    <div className="overleaf-settings" role="region" aria-label="Overleaf settings">
      <div className="overleaf-settings__account">
        <span>Signed in to Overleaf</span>
        <Button size="sm" variant="cancel" onClick={() => void session.disconnect()}>Disconnect</Button>
      </div>
      {accountRows.length > 0 && (
        <fieldset className="overleaf-settings__picks">
          <legend>Projects to show</legend>
          <p className="muted">Projects linked to this WeaveForge project (★) always show.</p>
          <div className="overleaf-settings__tools">
            <input
              type="search"
              aria-label="Find a project to show"
              placeholder="Find a project"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button size="sm" variant="ghost" onClick={() => onPick(null)}>Show all</Button>
            <Button size="sm" variant="ghost" onClick={() => onPick(new Set())}>Hide all</Button>
          </div>
          <ul>
            {shown.map((row) => (
              <li key={row.id}>
                <label>
                  <input type="checkbox" checked={isOn(row.id)} onChange={() => toggle(row.id)} />
                  {" "}{row.name}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      <div>
        <Button size="sm" variant="primary" onClick={onClose}>Done</Button>
      </div>
    </div>
  );
}
