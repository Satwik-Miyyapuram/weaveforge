/**
 * Which addresses the server is allowed to fetch on a visitor's behalf.
 *
 * Any feature that takes a URL from a person and requests it from the server is
 * a request *from inside the network*, made with the server's credentials and
 * its view of the routing table. `http://169.254.169.254/latest/meta-data/`
 * returns cloud instance credentials; `http://127.0.0.1:5432` reaches the
 * database; `http://10.0.0.5/admin` reaches whatever else is on the subnet. The
 * fetch is the feature, so the fix is not to refuse URLs but to refuse
 * *addresses*.
 *
 * This file is the policy and holds no I/O, so it is the same rules on the
 * server, in the Electron main process and in a test. The caller resolves the
 * hostname and asks about every address it got back, because a name is not an
 * address: `evil.example` resolving to `127.0.0.1` is the whole attack.
 */

/** Why a URL was refused. Phrased for a person, not a log. */
export type UrlRejection =
  | "not-a-url"
  | "scheme"
  | "credentials"
  | "port"
  | "private-address"
  | "hostname";

export interface UrlCheck {
  ok: boolean;
  reason?: UrlRejection;
}

const ALLOWED = new Set(["http:", "https:"]);

/**
 * Ports worth reaching over http(s), plus the empty default.
 *
 * An allowlist rather than a blocklist: `http://internal:6379/` speaks to Redis
 * well enough to be useful to an attacker, and enumerating every such port is a
 * game nobody wins. 8080 and friends are here because a self-hoster really does
 * run things there.
 */
const ALLOWED_PORTS = new Set(["", "80", "443", "8000", "8008", "8080", "8443", "3000", "5000"]);

/**
 * Hostnames that mean "this machine" or "this network" whatever DNS says.
 *
 * Checked before resolution as a cheap first pass; the address check after
 * resolution is what actually holds, since none of these names is required.
 */
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".onion"];
const BLOCKED_NAMES = new Set(["localhost", "metadata.google.internal", "instance-data"]);

/** Parses a URL, accepting a scheme-less host the way a person would type it. */
export function parseUserUrl(input: string): URL | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
}

/**
 * Everything that can be decided from the URL alone.
 *
 * The address check is separate and comes after DNS: this half rejects the
 * obvious, so a caller does no network work for a URL that was never going to
 * be allowed.
 */
export function checkUrlShape(input: string | URL): UrlCheck {
  const url = typeof input === "string" ? parseUserUrl(input) : input;
  if (!url) return { ok: false, reason: "not-a-url" };
  if (!ALLOWED.has(url.protocol)) return { ok: false, reason: "scheme" };
  // Credentials in a URL are a way to make a request look like it came from
  // somebody, and no legitimate paste carries them.
  if (url.username || url.password) return { ok: false, reason: "credentials" };
  if (!ALLOWED_PORTS.has(url.port)) return { ok: false, reason: "port" };

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return { ok: false, reason: "hostname" };
  if (BLOCKED_NAMES.has(host)) return { ok: false, reason: "hostname" };
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return { ok: false, reason: "hostname" };
  // A bare label with no dot is an intranet name; a public host always has one.
  // Bracketed IPv6 and dotted IPv4 keep their own check below.
  if (!host.includes(".") && !host.includes(":")) return { ok: false, reason: "hostname" };

  // A literal address in the URL skips DNS entirely, so it is checked here.
  const literal = host.startsWith("[") ? host.slice(1, -1) : host;
  if (isIpAddress(literal) && !isPublicAddress(literal)) {
    return { ok: false, reason: "private-address" };
  }

  return { ok: true };
}

/** True when the string is an IPv4 or IPv6 literal. */
export function isIpAddress(value: string): boolean {
  return parseIpv4(value) !== null || value.includes(":");
}

function parseIpv4(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    octets.push(octet);
  }
  return octets;
}

/**
 * True when an address is one the internet can route to somebody else.
 *
 * Everything private, reserved, local or special-purpose is refused, and so is
 * anything unparseable — an address this cannot read is not one to trust.
 */
export function isPublicAddress(address: string): boolean {
  const ipv4 = parseIpv4(address);
  if (ipv4) return isPublicIpv4(ipv4);
  if (address.includes(":")) return isPublicIpv6(address);
  return false;
}

function isPublicIpv4([a, b]: number[]): boolean {
  if (a === undefined || b === undefined) return false;
  if (a === 0) return false; // "this network"
  if (a === 10) return false; // private
  if (a === 127) return false; // loopback
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local, and the metadata endpoint
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 0) return false; // protocol assignments, including 192.0.0.192
  if (a === 192 && b === 168) return false; // private
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

/**
 * Expands an IPv6 address to its eight groups, or null when it is not one.
 *
 * Written out rather than pattern-matched on the text, because `URL` normalises
 * what it is given: `[::ffff:127.0.0.1]` comes back as `::ffff:7f00:1`, and a
 * check that looked for the dotted form let loopback straight through.
 */
export function expandIpv6(value: string): number[] | null {
  const address = value.toLowerCase().split("%")[0]!;
  if (!address.includes(":")) return null;

  // A trailing dotted quad is the last two groups written in IPv4.
  let head = address;
  const tail: number[] = [];
  const dotted = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (dotted) {
    const octets = parseIpv4(dotted[1]!);
    if (!octets) return null;
    tail.push((octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!);
    head = address.slice(0, dotted.index).replace(/:$/, ":");
  }

  const halves = head.split("::");
  if (halves.length > 2) return null;

  const toGroups = (part: string): number[] | null => {
    if (part === "" || part === ":") return [];
    const groups: number[] = [];
    for (const piece of part.split(":")) {
      if (piece === "") continue;
      if (!/^[0-9a-f]{1,4}$/.test(piece)) return null;
      groups.push(parseInt(piece, 16));
    }
    return groups;
  };

  const left = toGroups(halves[0] ?? "");
  const right = halves.length === 2 ? toGroups(halves[1] ?? "") : [];
  if (!left || !right) return null;

  const known = left.length + right.length + tail.length;
  if (halves.length === 2) {
    if (known > 8) return null;
    return [...left, ...Array<number>(8 - known).fill(0), ...right, ...tail];
  }
  const groups = [...left, ...tail];
  return groups.length === 8 ? groups : null;
}

function isPublicIpv6(address: string): boolean {
  const groups = expandIpv6(address);
  if (!groups) return false;

  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [
    number, number, number, number, number, number, number, number,
  ];

  // A v4-mapped (::ffff:0:0/96) or v4-compatible (::/96) address is an IPv4
  // address wearing a hat, and the v4 rules are the ones that apply.
  const leadingZero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  if (leadingZero && (g5 === 0xffff || g5 === 0)) {
    if (g6 === 0 && g7 === 0) return false; // ::
    if (g5 === 0 && g6 === 0 && g7 === 1) return false; // ::1
    return isPublicIpv4([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff]);
  }

  if (groups.every((group) => group === 0)) return false; // unspecified
  if ((g0 & 0xffc0) === 0xfe80) return false; // link-local fe80::/10
  if ((g0 & 0xfe00) === 0xfc00) return false; // unique local fc00::/7
  if ((g0 & 0xff00) === 0xff00) return false; // multicast ff00::/8
  if (g0 === 0x2001 && g1 === 0x0db8) return false; // documentation
  if (g0 === 0x2001 && (g1 & 0xff00) === 0x0000) return false; // 2001::/23 special-purpose
  if (g0 === 0x0064 && g1 === 0xff9b) return false; // NAT64, which translates to v4
  if (g0 === 0x2002) return false; // 6to4, likewise
  return true;
}
/** Limits a fetch on the visitor's behalf runs under. */
export interface OutboundFetchLimits {
  /** Redirect hops followed. Each one is re-checked. */
  maxRedirects: number;
  /** Bytes read before the response is abandoned. */
  maxBytes: number;
  /** Wall-clock budget for the whole fetch, redirects included. */
  timeoutMs: number;
}

/** Enough for a page's head or a figure, not enough to be a download service. */
export const DEFAULT_FETCH_LIMITS: OutboundFetchLimits = {
  maxRedirects: 4,
  maxBytes: 8 * 1024 * 1024,
  timeoutMs: 10_000,
};

/** What to say to the person who pasted the URL. */
export function describeRejection(reason: UrlRejection): string {
  switch (reason) {
    case "not-a-url":
      return "That is not a web address.";
    case "scheme":
      return "Only http and https addresses can be fetched.";
    case "credentials":
      return "Addresses carrying a username or password are not fetched.";
    case "port":
      return "That port is not one WeaveForge will fetch from.";
    case "private-address":
      return "That address is on a private network, so it is not fetched.";
    case "hostname":
      return "That host is not reachable from the public internet.";
  }
}
