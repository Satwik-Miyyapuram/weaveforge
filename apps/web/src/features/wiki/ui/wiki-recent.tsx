"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { recentlyApprovedWikiPages } from "../application/build-wiki";

const DATE = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });

/** The wiki pages approved most recently, so a finished review has a visible result. */
export function WikiRecentlyApproved({ refreshKey }: { refreshKey: number }) {
  const [pages, setPages] = useState<Awaited<ReturnType<typeof recentlyApprovedWikiPages>> | null>(null);

  useEffect(() => {
    let current = true;
    void recentlyApprovedWikiPages()
      .then((p) => {
        if (current) setPages(p);
      })
      .catch(() => {
        if (current) setPages([]);
      });
    return () => {
      current = false;
    };
  }, [refreshKey]);

  if (!pages || pages.length === 0) return null;
  return (
    <div className="card add-form wiki-recent">
      <h3 className="settings-group">Recently approved</h3>
      <ul className="wiki-recent-list">
        {pages.map((page) => (
          <li key={page.id}>
            <Link href={`/notes?page=${encodeURIComponent(page.id)}`}>{page.title}</Link>
            <span className="muted">{DATE.format(new Date(page.createdAt))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
