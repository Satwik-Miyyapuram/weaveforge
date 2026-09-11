/**
 * The error taxonomy — one root, four typed branches, and the single place that
 * decides what HTTP status a thrown value becomes.
 *
 * ## Why this exists
 *
 * Every feature used to declare its own error class as a direct subclass of
 * `Error` (`VaultPageValidationError`, `PaperValidationError`, …), which made
 * two things impossible:
 *
 * 1. a caller could not ask "was this a missing row, a bad input, or a
 *    permission failure?" without knowing every feature's class name; and
 * 2. each HTTP route re-derived the status from whichever class it happened to
 *    import, so the *same* condition came back as `400` on one route and `403`
 *    on another.
 *
 * Now every feature class extends one of these branches, so `instanceof` a
 * branch is enough. Every previously exported class name still exists — it is
 * simply a subclass of a branch rather than of `Error` — so no existing import,
 * `catch`, or `instanceof` check changes meaning.
 *
 * ## Where the status mapping lives
 *
 * In this module, deliberately, even though an HTTP status is a transport
 * concern: two routes disagreeing about the same exception is precisely the
 * defect this fixes, and the only way to make that impossible is to have one
 * function that answers it. Routes call {@link httpStatusForError} instead of
 * comparing error classes.
 */

/**
 * Root of every error WeaveForge throws on purpose.
 *
 * Catch this to separate "a rule of ours refused" from a genuine programming
 * error (a `TypeError`, a null dereference) surfacing from the same call.
 */
export class WeaveForgeError extends Error {
  constructor(message: string) {
    super(message);
    // `new.target.name` keeps `name` in step with the subclass actually
    // constructed. Subclasses that set their own `name` still win, because
    // their field assignment runs after this constructor.
    this.name = new.target.name;
  }
}

/** The request is malformed or breaks an invariant of the entity. */
export class ValidationError extends WeaveForgeError {}

/** The caller is known but not allowed to do this. */
export class PermissionError extends WeaveForgeError {}

/** The thing named by the request does not exist. */
export class NotFoundError extends WeaveForgeError {}

/** The write contradicts state that already exists. */
export class ConflictError extends WeaveForgeError {}

/** Status codes, named so no route spells a number out. */
export const ERROR_STATUS_BAD_REQUEST = 400;
export const ERROR_STATUS_FORBIDDEN = 403;
export const ERROR_STATUS_NOT_FOUND = 404;
export const ERROR_STATUS_CONFLICT = 409;
export const ERROR_STATUS_INTERNAL = 500;

/**
 * The HTTP status for anything a use case or service threw.
 *
 * Anything that is not one of the four branches is a server error — including a
 * plain `Error`, which would be a bug rather than a rule. Checked most specific
 * first so a future subclass of a subclass still lands correctly.
 */
export function httpStatusForError(error: unknown): number {
  if (error instanceof NotFoundError) return ERROR_STATUS_NOT_FOUND;
  if (error instanceof PermissionError) return ERROR_STATUS_FORBIDDEN;
  if (error instanceof ConflictError) return ERROR_STATUS_CONFLICT;
  if (error instanceof ValidationError) return ERROR_STATUS_BAD_REQUEST;
  return ERROR_STATUS_INTERNAL;
}

/** True for anything thrown on purpose by this domain. */
export function isWeaveForgeError(error: unknown): error is WeaveForgeError {
  return error instanceof WeaveForgeError;
}
