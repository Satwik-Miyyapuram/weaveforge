/**
 * The token out of an `Authorization: Bearer <token>` header, or null.
 *
 * Four route groups each carried their own copy of this line. One is enough:
 * the header's spelling is fixed by RFC 6750, not by which route reads it.
 */
export function bearerToken(request: Request): string | null {
  return request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
}
