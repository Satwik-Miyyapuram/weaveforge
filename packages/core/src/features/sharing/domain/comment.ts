/**
 * Comment domain — a flat feedback thread on a shared (or owned) item, so a
 * supervisor can respond in-app. Persisted in the `comments` table (0018);
 * visibility/insert are gated by the same access rules as the resource.
 */

import type { Identifiable } from "../../../shared/repository.js";
import { ValidationError } from "../../../shared/errors.js";

export interface Comment extends Identifiable {
  id: string;
  /** Empty on the client for a new comment — the DB defaults it to auth.uid(). */
  authorId: string;
  resourceType: string;
  resourceId: string;
  body: string;
  createdAt: string;
  /** The passage the comment is about; absent for a page-level comment or a reply. */
  anchor?: CommentAnchor | null;
  /** The thread root this answers; absent on a root. */
  parentId?: string | null;
  /** When the thread was resolved; set on roots only. */
  resolvedAt?: string | null;
}

/**
 * A passage, as the text itself plus a little context either side (the W3C
 * TextQuoteSelector shape). Re-found in whatever the body has become rather
 * than held as offsets, which go stale with the first edit above it.
 */
export interface CommentAnchor {
  quote: string;
  prefix: string;
  suffix: string;
}

export interface NewCommentInput {
  resourceType: string;
  resourceId: string;
  body: string;
  anchor?: CommentAnchor | null;
  parentId?: string | null;
}

export class CommentValidationError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = "CommentValidationError";
  }
}

export function normalizeCommentInput(input: NewCommentInput): NewCommentInput {
  const body = input.body?.trim();
  if (!body) throw new CommentValidationError("A comment can't be empty.");
  if (!input.resourceId) throw new CommentValidationError("A target resource is required.");
  const quote = input.anchor?.quote?.trim();
  // A reply belongs to its root's passage; an anchor on it would be a second one.
  const anchor = quote && !input.parentId
    ? { quote: input.anchor!.quote, prefix: input.anchor!.prefix ?? "", suffix: input.anchor!.suffix ?? "" }
    : null;
  return {
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    body,
    anchor,
    parentId: input.parentId || null,
  };
}
