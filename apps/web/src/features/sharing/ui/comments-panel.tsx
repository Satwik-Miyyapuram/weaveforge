"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Comment, Member } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { DeleteIcon } from "@/components/view-icons";
import { useProfile } from "@/features/org";
import { formatError } from "@/lib/format-error";

/**
 * A lightweight feedback thread on an item. Anyone with view access sees it;
 * the add box is shown only when the viewer can comment (owner, supervisor, or
 * a comment-level share). Server RLS is the real gate.
 */
export function CommentsPanel({
  resourceType,
  resourceId,
  canComment,
}: {
  resourceType: string;
  resourceId: string;
  canComment: boolean;
}) {
  const { profile, team } = useProfile();
  const [comments, setComments] = useState<Comment[]>([]);
  const [members, setMembers] = useState<Member[]>(team);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setComments(await getContainer().sharing.manageComments.list(resourceType, resourceId));
  }, [resourceType, resourceId]);

  useEffect(() => {
    let alive = true;
    void reload();
    getContainer().sharing.listDirectory()
      .then((d) => alive && setMembers(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [reload]);

  const nameOf = useMemo(() => {
    const map = new Map(members.map((m) => [m.id, m.fullName ?? m.email ?? "Member"]));
    return (id: string) => (id === profile?.id ? "You" : map.get(id) ?? "Member");
  }, [members, profile?.id]);

  async function add() {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await getContainer().sharing.manageComments.add({ resourceType, resourceId, body });
      setBody("");
      await reload();
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: Comment) {
    await getContainer().sharing.manageComments.remove(c.id);
    await reload();
  }

  return (
    <div className="comments">
      {comments.length === 0 && <p className="muted comments-empty">No comments yet.</p>}
      <ul className="comment-list">
        {comments.map((c) => (
          <li key={c.id} className="comment">
            <div className="comment-head">
              {c.authorId === profile?.id && (
                <button
                  type="button"
                  className="entity-icon-btn danger comment-del"
                  onClick={() => void remove(c)}
                  aria-label="Delete comment"
                  title="Delete"
                >
                  <DeleteIcon size={14} />
                </button>
              )}
              <span className="comment-author">{nameOf(c.authorId)}</span>
              <span className="muted comment-time">{c.createdAt.slice(0, 10)}</span>
            </div>
            <p className="comment-body">{c.body}</p>
          </li>
        ))}
      </ul>
      {error && <p className="error">{error}</p>}
      {canComment && (
        <div className="comment-add">
          <textarea
            rows={2}
            value={body}
            placeholder="Leave feedback…"
            onChange={(e) => setBody(e.target.value)}
          />
          <button className="btn-primary" disabled={busy || !body.trim()} onClick={() => void add()}>
            {busy ? "Posting…" : "Comment"}
          </button>
        </div>
      )}
    </div>
  );
}
