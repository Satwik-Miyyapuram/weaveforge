/** A draft's preview split for a card: bold first line → title, "Why:" → reason. */
export interface ProposalPreview {
  title: string | null;
  why: string | null;
  body: string;
}

export function splitProposalContent(content: string): ProposalPreview {
  let rest = content.trim();
  let title: string | null = null;
  let why: string | null = null;
  const head = /^\*\*([^*\n]+)\*\*\s*(?:\n|$)/.exec(rest);
  if (head) {
    title = head[1]!.trim();
    rest = rest.slice(head[0].length).trimStart();
  }
  const reason = /^Why: ([^\n]+)\s*(?:\n|$)/.exec(rest);
  if (reason) {
    why = reason[1]!.trim();
    rest = rest.slice(reason[0].length).trimStart();
  }
  return { title, why, body: rest };
}
