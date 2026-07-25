/**
 * Comment domain — a flat feedback thread on a shared (or owned) item, so a
 * supervisor can respond in-app. Persisted in the `comments` table (0018);
 * visibility/insert are gated by the same access rules as the resource.
 */

import type { Identifiable } from "../../../shared/repository.js";

export interface Comment extends Identifiable {
  id: string;
  /** Empty on the client for a new comment — the DB defaults it to auth.uid(). */
  authorId: string;
  resourceType: string;
  resourceId: string;
  body: string;
  createdAt: string;
}

export interface NewCommentInput {
  resourceType: string;
  resourceId: string;
  body: string;
}

export class CommentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommentValidationError";
  }
}

export function normalizeCommentInput(input: NewCommentInput): NewCommentInput {
  const body = input.body?.trim();
  if (!body) throw new CommentValidationError("A comment can't be empty.");
  if (!input.resourceId) throw new CommentValidationError("A target resource is required.");
  return { resourceType: input.resourceType, resourceId: input.resourceId, body };
}
