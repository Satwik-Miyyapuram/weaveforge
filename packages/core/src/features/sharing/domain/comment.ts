/** Types for comment. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
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

/** Signatures of the functions that moved to the Rust core (wf-wasm). */
export interface CommentFns {
  normalizeCommentInput(input: NewCommentInput): NewCommentInput;
}
