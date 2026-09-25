/**
 * Making an error report safe to send.
 *
 * A report is written by a program in a research app and read by a person on a
 * public issue tracker, and the two do not agree about what is sensitive. Messages
 * quote request URLs; a failed fetch prints the headers it sent; a Supabase error
 * carries the token in a `detail`; a stack trace carries the account name in a
 * Windows path. None of that is an error, and all of it is a leak.
 *
 * So the rule is subtractive: redact by shape, on the server, regardless of what
 * the client claims to have sent. The client redacts too — a reader should see
 * what will be posted before it is posted — but a client cannot be trusted to have
 * done it, and the route is the last place that can decide.
 *
 * What this cannot do is un-send note content that a log line happens to quote.
 * That is why the collector upstream records *errors and warnings only*, never
 * `console.log`, and why the UI shows the payload before sending.
 */

export interface RedactionOutcome {
  text: string;
  /** How many spans were replaced, so a caller can say "12 items redacted". */
  redactions: number;
}

/**
 * Patterns are applied in order, and the order matters: a JWT is three
 * base64url segments, so the generic long-token rule would chew it into
 * unrecognisable pieces if it ran first. Sensitive-shaped things are removed
 * before generic-shaped ones.
 */
const RULES: { pattern: RegExp; replacement: string }[] = [
  // A JWT — Supabase access and refresh tokens, and anything else minted the same
  // way. Three segments, each long enough not to be a coincidence.
  {
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replacement: "<jwt>",
  },
  // An Authorization header, in any casing, whatever scheme it carries.
  { pattern: /\b(bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, replacement: "$1 <redacted>" },
  // Provider key prefixes that identify themselves. `sk-` needs the length rule
  // because it collides with ordinary prose.
  {
    pattern: /\b(sbp_|ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{8,}/g,
    replacement: "<key>",
  },
  { pattern: /\bsk-[A-Za-z0-9_-]{16,}/g, replacement: "<key>" },
  // A credential in a query string. Keeps the parameter name, which is the part
  // that is useful in a bug report.
  {
    pattern: /([?&](?:key|token|access_token|refresh_token|apikey|api_key|secret|code|password|signature)=)[^&\s"']+/gi,
    replacement: "$1<redacted>",
  },
  // An absolute home directory: `C:\Users\sam\...`, `/Users/sam/...`,
  // `/home/sam/...`. The account name is the leaf, and it is somebody's name.
  { pattern: /([A-Za-z]:\\Users\\|\/Users\/|\/home\/|\/var\/folders\/[^/]+\/)[^\\/\s"']+/g, replacement: "$1<user>" },
  // An email address.
  { pattern: /\b[\w.%+-]+@[\w-]+\.[\w.-]{2,}\b/g, replacement: "<email>" },
  // A long opaque blob: base64 or hex, which is what a key, a wrapped key, an
  // encrypted payload or a bytea column looks like once it is in a string.
  // Forty characters is above the longest identifier in this schema and below
  // anything a person writes by accident.
  { pattern: /\b[A-Za-z0-9+/]{40,}={0,2}\b/g, replacement: "<blob>" },
  { pattern: /\b[0-9a-f]{40,}\b/gi, replacement: "<blob>" },
];

/** The most text a single report field may carry, after redaction. */
export const MAX_REPORT_CHARS = 8_000;

export function redact(input: string): RedactionOutcome {
  let text = input;
  let redactions = 0;

  for (const { pattern, replacement } of RULES) {
    // A fresh regex per rule and per call: these are global, and a `g` regex
    // carries its `lastIndex` between uses, so the second field would otherwise
    // start matching from wherever the first one stopped.
    const found = [...text.matchAll(new RegExp(pattern.source, pattern.flags))];
    if (found.length === 0) continue;
    redactions += found.length;
    // `$1` in the replacement refers to that rule's own capture group, which is
    // how a query-string credential keeps its parameter name.
    text = text.replace(new RegExp(pattern.source, pattern.flags), replacement);
  }

  return { text, redactions };
}

/**
 * Redact, and keep the result to a length a person will read.
 *
 * Truncation is announced rather than silent: a report that ends mid-stack with no
 * marker reads as though that was the whole trace.
 */
export function redactAndCap(input: string, limit = MAX_REPORT_CHARS): RedactionOutcome {
  const { text, redactions } = redact(input);
  if (text.length <= limit) return { text, redactions };
  return {
    text: `${text.slice(0, limit)}\n\n… truncated at ${limit} characters (${text.length - limit} more)`,
    redactions,
  };
}
