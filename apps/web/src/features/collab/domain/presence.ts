/** Someone else in a document, as the presence avatars show them. */
export interface Peer {
  /** Account id, or `client:<n>` for a client that sent none. */
  key: string;
  name: string;
  color: string;
}
