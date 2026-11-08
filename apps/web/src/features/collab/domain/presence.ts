/** Someone else in a document, as the presence avatars show them. */
export interface Peer {
  /** Account id, or `client:<n>` for a client that sent none. */
  key: string;
  name: string;
  color: string;
}

type UserState = { user?: { id?: unknown; name?: unknown; color?: unknown } };

/**
 * Awareness states → one entry per other person. Your own client and your
 * other sessions (another window, the phone) are left out; one person in two
 * windows shows once. Keyed by account id, not name, so two people who share
 * a name stay two.
 */
export function peersFromStates(
  states: ReadonlyMap<number, unknown>,
  self: { clientId: number; authorId: string },
): Peer[] {
  const peers = new Map<string, Peer>();
  states.forEach((state, clientId) => {
    if (clientId === self.clientId) return;
    const user = (state as UserState | null)?.user;
    if (!user) return;
    const id = typeof user.id === "string" && user.id ? user.id : null;
    if (id === self.authorId) return;
    const key = id ?? `client:${clientId}`;
    if (peers.has(key)) return;
    peers.set(key, {
      key,
      name: typeof user.name === "string" && user.name ? user.name : "Someone",
      color: typeof user.color === "string" && user.color ? user.color : "var(--accent)",
    });
  });
  return [...peers.values()];
}

/** True when both lists show the same people the same way. */
export function samePeers(a: readonly Peer[], b: readonly Peer[]): boolean {
  return (
    a.length === b.length &&
    a.every((p, i) => p.key === b[i]!.key && p.name === b[i]!.name && p.color === b[i]!.color)
  );
}
