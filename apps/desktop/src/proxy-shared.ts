/** What every shell proxy shares: its injectable fetch and its error answer. */

export type ProxyFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** A JSON `{ error }` answer with the given status. */
export function refuse(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
