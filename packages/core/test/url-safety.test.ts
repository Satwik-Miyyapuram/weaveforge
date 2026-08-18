import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkUrlShape,
  isPublicAddress,
  parseUserUrl,
  describeRejection,
  DEFAULT_FETCH_LIMITS,
} from "../src/net/url-safety.js";

const ok = (url: string) => assert.equal(checkUrlShape(url).ok, true, url);
const no = (url: string, reason: string) => {
  const result = checkUrlShape(url);
  assert.equal(result.ok, false, `${url} should be refused`);
  assert.equal(result.reason, reason, `${url} refused for the wrong reason`);
};

test("ordinary public addresses are allowed", () => {
  for (const url of [
    "https://example.com/page",
    "http://example.com:8080/page",
    "https://sub.domain.example.co.uk/a?b=c#d",
    "https://arxiv.org/abs/1706.03762",
    "example.com/page",
  ]) {
    ok(url);
  }
});

test("only http and https", () => {
  for (const url of ["file:///etc/passwd", "ftp://example.com/x", "gopher://example.com"]) {
    no(url, "scheme");
  }
  // A scheme-less string is read as https, not refused.
  assert.equal(parseUserUrl("example.com")?.protocol, "https:");
});

test("the cloud metadata endpoints are refused by address", () => {
  // The one that returns instance credentials, in all its spellings.
  no("http://169.254.169.254/latest/meta-data/", "private-address");
  no("http://169.254.170.2/v2/credentials", "private-address");
  no("http://[fd00:ec2::254]/latest/meta-data/", "private-address");
  no("http://192.0.0.192/latest/", "private-address");
  no("http://metadata.google.internal/computeMetadata/v1/", "hostname");
});

test("loopback, private and link-local literals are refused", () => {
  for (const host of [
    "127.0.0.1",
    "127.1.2.3",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.1.1",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "198.18.0.1",
  ]) {
    no(`http://${host}/`, "private-address");
  }
  // Just outside each private range is public again.
  for (const host of ["172.15.0.1", "172.32.0.1", "100.63.0.1", "100.128.0.1", "11.0.0.1"]) {
    ok(`http://${host}/`);
  }
});

test("IPv6 loopback, unique-local and mapped v4 are refused", () => {
  for (const host of ["[::1]", "[::]", "[fe80::1]", "[fc00::1]", "[fd12:3456::1]", "[ff02::1]", "[::ffff:127.0.0.1]", "[::ffff:10.0.0.1]", "[64:ff9b::7f00:1]", "[2001:db8::1]"]) {
    no(`http://${host}/`, "private-address");
  }
  ok("http://[2606:4700:4700::1111]/");
});

test("names that mean this machine are refused before DNS is asked", () => {
  for (const host of ["localhost", "app.localhost", "printer.local", "db.internal", "x.home.arpa", "y.onion"]) {
    no(`http://${host}/`, "hostname");
  }
  // A bare label with no dot is an intranet name.
  no("http://intranet/", "hostname");
});

test("credentials in the URL are refused", () => {
  no("http://user:pass@example.com/", "credentials");
  no("http://user@example.com/", "credentials");
});

test("ports are an allowlist, because a blocklist is a game nobody wins", () => {
  ok("https://example.com:443/");
  ok("http://example.com:8080/");
  for (const port of [22, 25, 6379, 5432, 9200, 11211, 27017]) {
    no(`http://example.com:${port}/`, "port");
  }
});

test("an unreadable address is not trusted", () => {
  assert.equal(isPublicAddress("not-an-address"), false);
  assert.equal(isPublicAddress(""), false);
  assert.equal(isPublicAddress("1.2.3"), false);
  assert.equal(isPublicAddress("999.1.1.1"), false);
});

test("a trailing dot does not smuggle a name past the checks", () => {
  no("http://localhost./", "hostname");
});

test("every rejection can be explained to the person who pasted it", () => {
  for (const reason of ["not-a-url", "scheme", "credentials", "port", "private-address", "hostname"] as const) {
    assert.ok(describeRejection(reason).length > 10);
  }
});

test("the default limits are bounded", () => {
  assert.ok(DEFAULT_FETCH_LIMITS.maxRedirects <= 5);
  assert.ok(DEFAULT_FETCH_LIMITS.maxBytes <= 16 * 1024 * 1024);
  assert.ok(DEFAULT_FETCH_LIMITS.timeoutMs <= 30_000);
});
