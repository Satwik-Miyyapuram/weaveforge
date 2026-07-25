"use client";

import { useCallback, useEffect, useState } from "react";
import {
  SHARE_LINK_DEFAULT_TTL_DAYS,
  type ShareLink,
  type ShareableType,
} from "@thesis/core";
import { getContainer } from "@/bootstrap";

function formatExpiry(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ShareLinkPanel({
  resourceType,
  resourceId,
}: {
  resourceType: ShareableType;
  resourceId: string;
}) {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);

  const enabled = getContainer().sharing.shareLinksEnabled();

  const reload = useCallback(async () => {
    if (!enabled) return;
    setLinks(await getContainer().sharing.listShareLinks(resourceType, resourceId));
  }, [enabled, resourceType, resourceId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!enabled) return null;

  async function createLink() {
    setBusy(true);
    setError(null);
    setCreatedUrl(null);
    try {
      const { urlToken } = await getContainer().sharing.createShareLink({
        resourceType,
        resourceId,
      });
      const url = `${window.location.origin}/link?t=${encodeURIComponent(urlToken)}`;
      setCreatedUrl(url);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    setError(null);
    try {
      await getContainer().sharing.revokeShareLink({ id });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copyUrl(url: string) {
    await navigator.clipboard.writeText(url);
  }

  return (
    <div className="share-links">
      <h4 className="settings-group">Public link</h4>
      <p className="share-link-expiry-hint">
        New links expire after {SHARE_LINK_DEFAULT_TTL_DAYS} days by default.
      </p>
      {error && <p className="error">{error}</p>}
      {createdUrl && (
        <div className="share-link-created">
          <p className="muted">Copy this link now — the token is not shown again.</p>
          <code className="share-link-url" data-testid="share-link-url">{createdUrl}</code>
          <button type="button" className="link-btn" onClick={() => void copyUrl(createdUrl)}>
            Copy link
          </button>
        </div>
      )}
      {links.length > 0 && (
        <ul className="share-link-list">
          {links.map((link) => (
            <li key={link.id} className="share-link-row">
              <span className="muted">view-only link</span>
              <span className="muted">{new Date(link.createdAt).toLocaleDateString()}</span>
              {link.expiresAt ? (
                <span className="share-link-expiry-hint">expires {formatExpiry(link.expiresAt)}</span>
              ) : null}
              <button
                type="button"
                className="link-btn danger"
                disabled={busy}
                onClick={() => void revoke(link.id)}
              >
                revoke
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn-secondary" disabled={busy} onClick={() => void createLink()}>
        {busy ? "Creating…" : "Create view link"}
      </button>
    </div>
  );
}
