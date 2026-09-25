"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Comment, CommentAnchor, Member } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { CommentsIcon, DeleteIcon } from "@/components/view-icons";
import { FormError } from "@/components/form-error";
import { useProfile } from "@/features/org";
import { formatError } from "@/lib/format-error";
import { anchorAt, locateAnchor, type TextSpan } from "../domain/text-anchor";

/**
 * Margin comments on a note, the way a shared doc does them: select a passage,
 * comment on it, and the thread sits beside the note with the passage lit up in
 * the text. Threads take replies and resolve; resolved ones fold away.
 *
 * Anchors live in the rendered text (what the reader selected), not the
 * markdown source, so a quote across bold or a link still matches. The
 * highlight is drawn with the CSS Custom Highlight API: nothing is written into
 * the note's DOM, which React owns. Where that API is missing the threads still
 * work; they just aren't lit in the text.
 */
const OPEN_KEY = "wf-note-comments-open";
const HL = "wf-comment";
const HL_ACTIVE = "wf-comment-active";

interface Thread {
  root: Comment;
  replies: Comment[];
  span: TextSpan | null;
}

export function NoteComments({
  resourceType,
  resourceId,
  canComment,
  isOwner,
  contentRef,
  contentKey,
}: {
  resourceType: string;
  resourceId: string;
  canComment: boolean;
  /** The viewer owns the note, so may resolve anyone's thread. The server checks too. */
  isOwner: boolean;
  /** The rendered note. Null while the note is being edited. */
  contentRef: RefObject<HTMLElement | null>;
  /** Changes whenever the rendered text may have, so spans are found again. */
  contentKey: string;
}) {
  const { profile, team } = useProfile();
  const [comments, setComments] = useState<Comment[]>([]);
  const [members, setMembers] = useState<Member[]>(team);
  const [open, setOpen] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  const [pending, setPending] = useState<CommentAnchor | null>(null);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [selection, setSelection] = useState<{ anchor: CommentAnchor; x: number; y: number } | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const cardRefs = useRef(new Map<string, HTMLLIElement>());

  useEffect(() => {
    try {
      if (localStorage.getItem(OPEN_KEY) === "0") setOpen(false);
    } catch {
      /* a blocked store keeps the default */
    }
  }, []);

  function toggleOpen() {
    setOpen((was) => {
      try {
        localStorage.setItem(OPEN_KEY, was ? "0" : "1");
      } catch {
        /* remembered for this view only */
      }
      return !was;
    });
  }

  const reload = useCallback(async () => {
    setComments(await getContainer().sharing.manageComments.list(resourceType, resourceId));
  }, [resourceType, resourceId]);

  useEffect(() => {
    let alive = true;
    // A thread that cannot be read (no account, offline) is an empty one here.
    reload().catch(() => {});
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

  // The rendered text, re-read whenever the note re-renders.
  useEffect(() => {
    setText(contentRef.current?.textContent ?? "");
  }, [contentRef, contentKey]);

  const threads = useMemo(() => {
    const byRoot = new Map<string, Thread>();
    for (const c of comments) {
      if (!c.parentId) byRoot.set(c.id, { root: c, replies: [], span: c.anchor ? locateAnchor(text, c.anchor) : null });
    }
    for (const c of comments) if (c.parentId) byRoot.get(c.parentId)?.replies.push(c);
    // Pinned threads in reading order, then page-level ones, then detached ones.
    const rank = (t: Thread) => (t.span ? t.span.start : t.root.anchor ? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER - 1);
    return [...byRoot.values()].sort((a, b) => rank(a) - rank(b) || a.root.createdAt.localeCompare(b.root.createdAt));
  }, [comments, text]);

  const openThreads = useMemo(() => threads.filter((t) => !t.root.resolvedAt), [threads]);
  const resolved = useMemo(() => threads.filter((t) => t.root.resolvedAt), [threads]);

  // Light the open threads' passages, and the active one more strongly.
  useEffect(() => {
    const el = contentRef.current;
    const reg = typeof CSS !== "undefined" ? (CSS as unknown as { highlights?: Map<string, unknown> }).highlights : undefined;
    const HighlightCtor = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    if (!reg || !HighlightCtor) return;
    const all: Range[] = [];
    const active: Range[] = [];
    if (el) {
      for (const t of openThreads) {
        if (!t.span) continue;
        const range = rangeAt(el, t.span);
        if (!range) continue;
        (t.root.id === activeId ? active : all).push(range);
      }
    }
    reg.set(HL, new HighlightCtor(...all));
    reg.set(HL_ACTIVE, new HighlightCtor(...active));
    return () => {
      reg.delete(HL);
      reg.delete(HL_ACTIVE);
    };
  }, [contentRef, openThreads, activeId, text]);

  // Selecting text in the note offers a comment on it; clicking a lit passage
  // brings its thread forward.
  useEffect(() => {
    const el = contentRef.current;
    if (!el || !canComment) return;
    const onSelect = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return setSelection(null);
      const range = sel.getRangeAt(0);
      if (!el.contains(range.commonAncestorContainer)) return setSelection(null);
      const start = offsetOf(el, range.startContainer, range.startOffset);
      const end = offsetOf(el, range.endContainer, range.endOffset);
      const anchor = anchorAt(el.textContent ?? "", start, end);
      if (!anchor) return setSelection(null);
      const box = range.getBoundingClientRect();
      setSelection({ anchor, x: box.right, y: box.top });
    };
    // The popover is placed once; a scroll would leave it behind the text.
    const onScroll = () => setSelection(null);
    document.addEventListener("selectionchange", onSelect);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("selectionchange", onSelect);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [contentRef, canComment, contentKey]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const onClick = () => {
      const sel = window.getSelection();
      if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return;
      const at = offsetOf(el, sel.anchorNode!, sel.anchorOffset);
      const hit = openThreads.find((t) => t.span && at >= t.span.start && at <= t.span.end);
      if (!hit) return;
      setActiveId(hit.root.id);
      setOpen(true);
      cardRefs.current.get(hit.root.id)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [contentRef, openThreads, contentKey]);

  function startFromSelection() {
    if (!selection) return;
    setPending(selection.anchor);
    setSelection(null);
    setOpen(true);
    window.getSelection()?.removeAllRanges();
    requestAnimationFrame(() => composerRef.current?.focus());
  }

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      await reload();
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
    }
  }

  const add = () =>
    run(async () => {
      if (!draft.trim()) return;
      await getContainer().sharing.manageComments.add({ resourceType, resourceId, body: draft, anchor: pending });
      setDraft("");
      setPending(null);
    });

  const answer = (rootId: string) =>
    run(async () => {
      if (!reply.trim()) return;
      await getContainer().sharing.manageComments.add({ resourceType, resourceId, body: reply, parentId: rootId });
      setReply("");
      setReplyTo(null);
    });

  const resolve = (c: Comment, done: boolean) =>
    run(() => getContainer().sharing.manageComments.setResolved(c.id, done));

  const remove = (c: Comment) => run(() => getContainer().sharing.manageComments.remove(c.id));

  function renderThread(t: Thread) {
    const { root } = t;
    const mine = root.authorId === profile?.id;
    return (
      <li
        key={root.id}
        ref={(node) => {
          if (node) cardRefs.current.set(root.id, node);
          else cardRefs.current.delete(root.id);
        }}
        className={`note-thread${root.id === activeId ? " is-active" : ""}${root.resolvedAt ? " is-resolved" : ""}`}
        onClick={() => setActiveId(root.id)}
      >
        {root.anchor && (
          <p className={`note-thread-quote${t.span ? "" : " is-detached"}`} title={t.span ? undefined : "This passage is no longer in the note"}>
            {root.anchor.quote}
          </p>
        )}
        <CommentLine c={root} name={nameOf(root.authorId)} canDelete={mine} onDelete={() => void remove(root)} />
        {t.replies.map((r) => (
          <CommentLine
            key={r.id}
            c={r}
            name={nameOf(r.authorId)}
            canDelete={r.authorId === profile?.id}
            onDelete={() => void remove(r)}
          />
        ))}
        <div className="note-thread-actions">
          {canComment && !root.resolvedAt && replyTo !== root.id && (
            <button type="button" className="link-btn" onClick={() => { setReplyTo(root.id); setReply(""); }}>
              Reply
            </button>
          )}
          {(mine || isOwner) && (
            <button type="button" className="link-btn" disabled={busy} onClick={() => void resolve(root, !root.resolvedAt)}>
              {root.resolvedAt ? "Reopen" : "Resolve"}
            </button>
          )}
        </div>
        {replyTo === root.id && (
          <div className="comment-add">
            <textarea rows={2} value={reply} autoFocus placeholder="Reply…" onChange={(e) => setReply(e.target.value)} />
            <div className="note-thread-actions">
              <button type="button" className="btn-ghost btn-cancel" onClick={() => setReplyTo(null)}>Cancel</button>
              <button type="button" className="btn-primary" disabled={busy || !reply.trim()} onClick={() => void answer(root.id)}>
                Reply
              </button>
            </div>
          </div>
        )}
      </li>
    );
  }

  return (
    <section className={`record-section note-comments${open ? " is-open" : ""}`} id="record-comments">
      <h2 className="record-section-head">
        <button type="button" className="note-comments-toggle" aria-expanded={open} onClick={toggleOpen}>
          <span>Comments</span>
          <span className="record-section-tag">{openThreads.length > 0 ? String(openThreads.length) : "None"}</span>
        </button>
      </h2>

      {selection && (
        <button
          type="button"
          className="note-comment-pop"
          style={{ left: selection.x, top: selection.y }}
          // Keep the selection alive through the press.
          onMouseDown={(e) => e.preventDefault()}
          onClick={startFromSelection}
        >
          <CommentsIcon size={14} /> Comment
        </button>
      )}

      {open && (
        <div className="note-comments-body">
          {canComment && (
            <div className="comment-add">
              {pending && (
                <p className="note-thread-quote">
                  {pending.quote}
                </p>
              )}
              <textarea
                ref={composerRef}
                rows={2}
                value={draft}
                placeholder={pending ? "Comment on this passage…" : "Comment on the note, or select text to pin one…"}
                onChange={(e) => setDraft(e.target.value)}
              />
              <div className="note-thread-actions">
                {pending && (
                  <button type="button" className="btn-ghost btn-cancel" onClick={() => setPending(null)}>Cancel</button>
                )}
                <button type="button" className="btn-primary" disabled={busy || !draft.trim()} onClick={() => void add()}>
                  {busy ? "Posting…" : "Comment"}
                </button>
              </div>
            </div>
          )}
          {error && <FormError>{error}</FormError>}
          {openThreads.length === 0 && <p className="muted comments-empty">No open comments.</p>}
          <ul className="note-threads">{openThreads.map(renderThread)}</ul>
          {resolved.length > 0 && (
            <>
              <button type="button" className="note-comments-resolved" aria-expanded={showResolved} onClick={() => setShowResolved((v) => !v)}>
                Resolved ({resolved.length})
              </button>
              {showResolved && <ul className="note-threads">{resolved.map(renderThread)}</ul>}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function CommentLine({ c, name, canDelete, onDelete }: { c: Comment; name: string; canDelete: boolean; onDelete: () => void }) {
  return (
    <div className="note-comment">
      <div className="comment-head">
        <span className="comment-author">{name}</span>
        <span className="muted comment-time">{c.createdAt.slice(0, 10)}</span>
        {canDelete && (
          <button
            type="button"
            className="entity-icon-btn danger comment-del"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            aria-label="Delete comment"
            title="Delete"
          >
            <DeleteIcon size={14} />
          </button>
        )}
      </div>
      <p className="note-comment-body">{c.body}</p>
    </div>
  );
}

/** Character offset of a DOM point within `root`'s text. */
function offsetOf(root: Node, node: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  return range.toString().length;
}

/** A DOM range over `span` of `root`'s text, or null when the text has moved on. */
function rangeAt(root: Node, span: TextSpan): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let seen = 0;
  let started = false;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = n.nodeValue?.length ?? 0;
    if (!started && span.start <= seen + len) {
      range.setStart(n, span.start - seen);
      started = true;
    }
    if (started && span.end <= seen + len) {
      range.setEnd(n, span.end - seen);
      return range;
    }
    seen += len;
  }
  return null;
}
