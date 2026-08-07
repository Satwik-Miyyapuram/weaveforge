"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Member, Share, ShareableType, ShareAccess } from "@weaveforge/core";
import { isBlanketShare, shareSupportsEditAccess } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { useProfile } from "@/features/org";
import { Modal } from "@/components/modal";
import { Select } from "@/components/select";
import { MemberPicker } from "./member-picker";
import { ShareLinkPanel } from "./share-link-panel";

/**
 * Manage who an item (or all of a type, when `resourceId` is null) is shared
 * with. Lists current recipients with their access level (editable/revocable)
 * and adds new ones via the lab-directory picker. Access defaults to "comment".
 * Access is enforced by RLS — sharing grants database read/comment/edit; there
 * is no key exchange (client E2EE was dropped).
 */
export function ShareDialog({
  resourceType,
  resourceId,
  projectId,
  title,
  onClose,
}: {
  resourceType: ShareableType;
  resourceId: string | null;
  projectId?: string | null;
  title: string;
  onClose: () => void;
}) {
  const { profile } = useProfile();
  const activeProjectId = projectId ?? getContainer().projects.context.projectId;
  const [members, setMembers] = useState<Member[]>([]);
  const [shares, setShares] = useState<Share[]>([]);
  const [toAdd, setToAdd] = useState<string[]>([]);
  const [access, setAccess] = useState<ShareAccess>("comment");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isBlanket = isBlanketShare(resourceId);
  const supportsEdit = shareSupportsEditAccess(resourceType, resourceId);

  const reload = useCallback(async () => {
    setShares(await getContainer().sharing.manageSharing.listForResource(resourceType, resourceId));
  }, [resourceType, resourceId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [dir] = await Promise.all([
          getContainer().sharing.listDirectory(),
          reload(),
        ]);
        if (alive) setMembers(dir.filter((m) => m.id !== profile?.id));
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [reload, profile?.id]);

  const nameOf = useMemo(() => {
    const map = new Map(members.map((m) => [m.id, m.fullName ?? m.email ?? m.id]));
    return (id: string) => map.get(id) ?? id;
  }, [members]);

  const sharedIds = new Set(shares.map((s) => s.recipientId));
  const candidates = members.filter((m) => !sharedIds.has(m.id));

  const canGrant = toAdd.length > 0 && (!isBlanket || activeProjectId != null);

  async function grantSelected() {
    if (isBlanket && !activeProjectId) {
      setError("Select a project before blanket sharing.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      for (const recipientId of toAdd) {
        await getContainer().sharing.manageSharing.grant({ recipientId, resourceType, resourceId, access });
      }
      setToAdd([]);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function changeAccess(s: Share, next: ShareAccess) {
    await getContainer().sharing.manageSharing.grant({
      recipientId: s.recipientId,
      resourceType,
      resourceId,
      access: next,
    });
    await reload();
  }

  async function revoke(s: Share) {
    setBusy(true);
    setError(null);
    try {
      await getContainer().sharing.manageSharing.revoke(s.id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      {error && <p className="error">{error}</p>}
      {isBlanket && !activeProjectId && (
        <p className="error">Select a project to blanket-share.</p>
      )}

      <div className="share-current">
        {shares.length === 0 ? (
          <p className="muted">Not shared with anyone yet.</p>
        ) : (
          <ul className="share-list">
            {shares.map((s) => (
              <li key={s.id} className="share-row">
                <span className="share-name">{nameOf(s.recipientId)}</span>
                <Select
                  className="share-access"
                  value={s.access}
                  onChange={(e) => void changeAccess(s, e.target.value as ShareAccess)}
                >
                  <option value="view">can view</option>
                  <option value="comment">can comment</option>
                  {supportsEdit ? <option value="edit">can edit</option> : null}
                </Select>
                <button className="link-btn danger" onClick={() => void revoke(s)}>remove</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {resourceId && <ShareLinkPanel resourceType={resourceType} resourceId={resourceId} />}

      <div className="share-add">
        <h4 className="settings-group">Add people</h4>
        <MemberPicker
          members={candidates}
          selected={toAdd}
          onToggle={(id) => setToAdd((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))}
        />
        <div className="share-add-foot">
          <Select
            className="share-access"
            value={access}
            onChange={(e) => setAccess(e.target.value as ShareAccess)}
            aria-label="Access level"
          >
            <option value="comment">can comment</option>
            <option value="view">can view</option>
            {supportsEdit ? <option value="edit">can edit</option> : null}
          </Select>
          <button
            type="button"
            className="btn-primary share-add-submit"
            disabled={busy || !canGrant}
            onClick={() => void grantSelected()}
          >
            {busy ? "Sharing…" : toAdd.length > 0 ? `Share (${toAdd.length})` : "Share"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
