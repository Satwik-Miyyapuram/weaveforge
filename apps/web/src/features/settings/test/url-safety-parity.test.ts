import { before, test } from "node:test";
import assert from "node:assert/strict";
import * as ts from "@weaveforge/core";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Proves the Rust outbound URL and address checks return exactly what the TS
// originals in packages/core/src/net/url-safety.ts return.

let rs: RustCore;
before(async () => {
  rs = await loadTestCore();
});

/** Mulberry32, so a failure reproduces from the seed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)]!;
}

/** JSON round trip: TS leaves `undefined` keys that serde omits; both mean "absent". */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;

const href = (url: URL | null): string | null => url?.href ?? null;

const FIXED_URLS: string[] = [
  "", " ", " https://example.com ", "﻿https://example.com", "https://", "https://[::1",
  "http://exa mple.com", "://x", "https:///path", "HTTP://EXAMPLE.COM", "example.com", "example.com:8080",
  "ftp://example.com", "javascript:alert(1)", "file:///etc/passwd", "data:text/plain,hi", "mailto:a@b.co",
  "https://user:pw@example.com/", "https://user@example.com/", "https://:pw@example.com/",
  "https://example.com:3000/", "https://example.com:5000/", "https://example.com:8443/",
  "http://example.com:80/", "https://example.com:443/", "https://example.com:8081/",
  "https://localhost/", "http://a.localhost/", "https://printer.local/", "https://svc.internal/",
  "https://x.home.arpa/", "https://y.onion/", "http://metadata.google.internal/", "http://instance-data/",
  "http://intranet/", "https://example./", "https://example.com./", "https://ex_ample.com/",
  "https://例え.jp/", "https://a.b.c.d.example.org/x?y#z", "https://EXAMPLE.org",
  "http://127.0.0.1/", "http://10.0.0.5/admin", "http://169.254.169.254/latest/meta-data/",
  "http://172.16.0.1/", "http://172.31.255.255/", "http://172.32.0.1/", "http://192.168.1.1/",
  "http://100.64.0.1/", "http://100.127.255.255/", "http://100.128.0.1/", "http://0.0.0.0/",
  "http://255.255.255.255/", "http://224.0.0.1/", "http://8.8.8.8/", "http://2130706433/",
  "http://010.0.0.1/", "http://0x7f.0.0.1/", "http://198.18.0.1/", "http://192.0.0.192/",
  "http://[::1]/", "http://[::]/", "http://[fe80::1]/", "http://[fc00::1]/", "http://[fd12:3456::1]/",
  "http://[::ffff:10.0.0.1]/", "http://[::ffff:8.8.8.8]/", "http://[::ffff:127.0.0.1]/",
  "http://[::FFFF:7F00:1]/", "http://[2606:4700::1111]/", "http://[2001:db8::1]/",
  "http://[FE80::ABCD]/", "http://[ff02::1]/", "http://[64:ff9b::1]/", "http://[2002::1]/",
  "http://[2001:4860:4860::8888]/", "http://[0:0:0:0:0:0:0:1]/", "http://[::1%25eth0]/",
];

const PORTS = ["", "80", "443", "8000", "8008", "8080", "8443", "3000", "5000", "22", "6379", "8081"];
const SCHEMES = ["http:", "https:", "ftp:", "file:", "javascript:", "data:"];
const USERINFO = ["", "", "u@", "u:p@", ":p@"];
const HOSTS = [
  "example.com", "EXAMPLE.com.", "localhost", "a.localhost", "printer.local", "intranet", "svc.internal",
  "x.home.arpa", "y.onion", "metadata.google.internal", "instance-data", "127.0.0.1", "10.1.2.3",
  "172.16.0.1", "172.32.0.1", "192.168.0.9", "169.254.169.254", "100.64.0.1", "100.128.0.1", "0.0.0.0",
  "255.255.255.255", "224.0.0.1", "8.8.8.8", "2130706433", "0x7f.1", "010.0.0.1", "[::1]", "[::]",
  "[fe80::1]", "[fc00::1]", "[::ffff:10.0.0.1]", "[::ffff:8.8.8.8]", "[2606:4700::1111]", "[2001:db8::1]",
  "[FE80::ABCD]", "[::FFFF:127.0.0.1]", "例え.jp", "xn--bcher-kva.example", "ex_ample.com", "",
];
const TAILS = ["", "/", "/a?b=c#d"];

test("parseUserUrl matches TS on scheme-less, padded and malformed input", () => {
  for (const input of [...FIXED_URLS, "example.com/a b", "  localhost:3000  ", "[::1]:8080"]) {
    assert.equal(href(rs.parseUserUrl(input)), href(ts.parseUserUrl(input)), input);
  }
});

test("checkUrlShape matches TS on fixed hostile and benign URLs", () => {
  for (const url of FIXED_URLS) {
    assert.deepEqual(plain(rs.checkUrlShape(url)), plain(ts.checkUrlShape(url)), url);
  }
  // A URL object skips the parse step, so it takes the same checks through the wrapper's fields.
  for (const url of [new URL("https://example.com/"), new URL("http://[::ffff:10.0.0.1]/")]) {
    assert.deepEqual(plain(rs.checkUrlShape(url)), plain(ts.checkUrlShape(url)), String(url));
  }
});

test("checkUrlShape matches TS over seeded scheme, userinfo, host, port combinations", () => {
  for (let seed = 1; seed <= 400; seed += 1) {
    const rand = random(seed);
    const portPart = rand() < 0.4 ? "" : `:${pick(rand, PORTS)}`;
    const url = `${pick(rand, SCHEMES)}//${pick(rand, USERINFO)}${pick(rand, HOSTS)}${portPart}${pick(rand, TAILS)}`;
    assert.deepEqual(plain(rs.checkUrlShape(url)), plain(ts.checkUrlShape(url)), `seed ${seed} ${url}`);
  }
});

const IP_CHARS = [..."0123456789.:abcdefABCDEFx%[] "];
const IP_FIXED = [
  "", "1", "1.2.3", "1.2.3.4", "1.2.3.4.5", "256.1.1.1", "01.2.3.4", "::", "::1", "not:an:address",
  "[::1]", "010.0.0.1", "0x7f.0.0.1", "2130706433", "fe80::1%eth0", ":", "1::2::3",
];

test("isIpAddress matches TS on fixed and seeded strings", () => {
  for (const value of IP_FIXED) {
    assert.equal(rs.isIpAddress(value), ts.isIpAddress(value), value);
  }
  for (let seed = 1; seed <= 400; seed += 1) {
    const rand = random(seed);
    let value = "";
    for (let i = Math.floor(rand() * 24); i > 0; i -= 1) value += pick(rand, IP_CHARS);
    assert.equal(rs.isIpAddress(value), ts.isIpAddress(value), `seed ${seed} ${value}`);
  }
});

const OCTETS = [
  "0", "1", "8", "10", "16", "31", "32", "63", "64", "100", "127", "128", "168", "169", "172", "192",
  "198", "224", "254", "255", "256", "010", "00", "999",
];
const HEX_GROUPS = [
  "0", "1", "0000", "ffff", "FFFF", "fe80", "FE80", "fc00", "fd12", "ABCD", "2001", "db8", "64", "ff9b",
  "2002", "8888", "2606", "4700", "7f00",
];

function ipv4(rand: () => number): string {
  return Array.from({ length: 4 }, () => pick(rand, OCTETS)).join(".");
}

/** Compressed, full, mixed-case and dotted-tail IPv6 text, with an occasional zone id. */
function ipv6(rand: () => number): string {
  const count = 1 + Math.floor(rand() * 7);
  const groups = Array.from({ length: count }, () => pick(rand, HEX_GROUPS));
  const at = Math.floor(rand() * (count + 1));
  let text = rand() < 0.5 ? groups.join(":") : `${groups.slice(0, at).join(":")}::${groups.slice(at).join(":")}`;
  if (rand() < 0.3) text += `:${ipv4(rand)}`;
  if (rand() < 0.2) text = text.toUpperCase();
  if (rand() < 0.1) text += "%eth0";
  return text;
}

const ADDRESS_FIXED = [
  "10.0.0.1", "172.16.0.1", "172.31.255.255", "172.15.255.255", "172.32.0.0", "192.168.1.1",
  "192.169.0.1", "127.0.0.1", "169.254.1.1", "0.0.0.0", "0.1.2.3", "100.64.0.0", "100.127.255.255",
  "100.63.255.255", "255.255.255.255", "224.0.0.1", "8.8.8.8", "1.1.1.1", "192.0.0.192", "198.18.0.1",
  "198.20.0.1", "1.2.3", "1.2.3.4.5", "256.0.0.1", "010.0.0.1", "0x7f.0.0.1", "2130706433",
  "::1", "::", "fe80::1", "FE80::1", "febf::1", "fec0::1", "fc00::1", "fdff::1", "fe00::1",
  "::ffff:10.0.0.1", "::ffff:8.8.8.8", "::ffff:127.0.0.1", "::127.0.0.1", "::8.8.8.8", "::ffff:0:1",
  "2606:4700:4700::1111", "2001:db8::1", "2001:0db8:0:0::1", "2001::1", "2001:200::1",
  "2001:4860:4860::8888", "ff02::1", "64:ff9b::1", "2002:0808:0808::1", "1:2:3:4:5:6:7:8",
  "1:2:3:4:5:6:7::", "::2:3:4:5:6:7:8", "fe80::1%eth0", "::FFFF:10.0.0.1", "[::1]", "not:an:address",
  "1::2::3", "12345::", "::1.2.3.256", "", ":",
];

test("expandIpv6 matches TS on fixed addresses", () => {
  for (const value of ADDRESS_FIXED) {
    assert.deepEqual(plain(rs.expandIpv6(value)), plain(ts.expandIpv6(value)), value);
  }
});

test("expandIpv6 matches TS over seeded IPv6 text", () => {
  for (let seed = 1; seed <= 400; seed += 1) {
    const value = ipv6(random(seed));
    assert.deepEqual(plain(rs.expandIpv6(value)), plain(ts.expandIpv6(value)), `seed ${seed} ${value}`);
  }
});

test("isPublicAddress matches TS on fixed addresses", () => {
  for (const value of ADDRESS_FIXED) {
    assert.equal(rs.isPublicAddress(value), ts.isPublicAddress(value), value);
  }
});

test("isPublicAddress matches TS over seeded IPv4 and IPv6 text", () => {
  for (let seed = 1; seed <= 400; seed += 1) {
    const rand = random(seed);
    const v4 = ipv4(rand);
    const v6 = ipv6(rand);
    assert.equal(rs.isPublicAddress(v4), ts.isPublicAddress(v4), `seed ${seed} ${v4}`);
    assert.equal(rs.isPublicAddress(v6), ts.isPublicAddress(v6), `seed ${seed} ${v6}`);
  }
});
