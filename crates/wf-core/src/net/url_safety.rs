//! Port of the pure address and URL-shape checks in packages/core/src/net/url-safety.ts. Pure.
//!
//! URL parsing (WHATWG `URL`) stays in the TS wrapper, which passes the parsed protocol, credential
//! flag, port and hostname to [`check_url_shape`].

/// Protocols a user-supplied URL may use.
const ALLOWED_PROTOCOLS: &[&str] = &["http:", "https:"];

/// Ports worth reaching over http(s), plus the empty default.
const ALLOWED_PORTS: &[&str] = &["", "80", "443", "8000", "8008", "8080", "8443"];

/// Hostname suffixes that mean "this machine" or "this network" whatever DNS says.
const BLOCKED_SUFFIXES: &[&str] = &[".localhost", ".local", ".internal", ".home.arpa", ".onion"];

/// Hostnames that mean "this machine" or "this network" whatever DNS says.
const BLOCKED_NAMES: &[&str] = &["localhost", "metadata.google.internal", "instance-data"];

/// Why a URL was refused (TS `UrlRejection`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub enum UrlRejection {
    /// Could not be parsed as a URL. Produced by the TS wrapper, not by this module.
    NotAUrl,
    /// Protocol is not http or https.
    Scheme,
    /// Carries a username or password.
    Credentials,
    /// Port is not on the allowlist.
    Port,
    /// Literal address is private, reserved or local.
    PrivateAddress,
    /// Hostname names this machine or network.
    Hostname,
}

/// Result of a URL shape check (TS `UrlCheck`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct UrlCheck {
    /// True when the URL may be fetched.
    pub ok: bool,
    /// Why it was refused, absent when `ok`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "specta", specta(optional))]
    pub reason: Option<UrlRejection>,
}

fn refused(reason: UrlRejection) -> UrlCheck {
    UrlCheck {
        ok: false,
        reason: Some(reason),
    }
}

/// Everything that can be decided from the parsed URL parts alone.
///
/// `hostname` is the parsed hostname as the URL parser returns it (IPv6 keeps its brackets).
#[must_use]
pub fn check_url_shape(
    protocol: &str,
    has_credentials: bool,
    port: &str,
    hostname: &str,
) -> UrlCheck {
    if !ALLOWED_PROTOCOLS.contains(&protocol) {
        return refused(UrlRejection::Scheme);
    }
    if has_credentials {
        return refused(UrlRejection::Credentials);
    }
    if !ALLOWED_PORTS.contains(&port) {
        return refused(UrlRejection::Port);
    }

    let lower = hostname.to_lowercase();
    let host = lower.strip_suffix('.').unwrap_or(lower.as_str());
    if host.is_empty()
        || BLOCKED_NAMES.contains(&host)
        || BLOCKED_SUFFIXES.iter().any(|suffix| host.ends_with(suffix))
        // A bare label with no dot is an intranet name; a public host always has one.
        || (!host.contains('.') && !host.contains(':'))
    {
        return refused(UrlRejection::Hostname);
    }

    // A literal address in the URL skips DNS entirely, so it is checked here.
    let literal = bracket_inner(host);
    if is_ip_address(literal) && !is_public_address(literal) {
        return refused(UrlRejection::PrivateAddress);
    }

    UrlCheck {
        ok: true,
        reason: None,
    }
}

/// Drops the first and last character, as JS `slice(1, -1)` does for a bracketed host.
fn bracket_inner(host: &str) -> &str {
    if !host.starts_with('[') {
        return host;
    }
    let mut chars = host.chars();
    let _ = chars.next();
    let _ = chars.next_back();
    chars.as_str()
}

/// True when the string is an IPv4 or IPv6 literal.
///
/// The IPv6 half is a colon test, which is loose on purpose: a string that looks like IPv6 but is
/// not one fails [`expand_ipv6`] and is refused, so the looseness can only produce a refusal.
#[must_use]
pub fn is_ip_address(value: &str) -> bool {
    parse_ipv4(value).is_some() || value.contains(':')
}

/// True when an address is one the internet can route to somebody else.
///
/// Everything private, reserved, local or special-purpose is refused, and so is anything
/// unparseable.
#[must_use]
pub fn is_public_address(address: &str) -> bool {
    if let Some(octets) = parse_ipv4(address) {
        return is_public_ipv4(octets);
    }
    address.contains(':') && is_public_ipv6(address)
}

/// Expands an IPv6 address to its eight groups, or null when it is not one.
#[must_use]
pub fn expand_ipv6(value: &str) -> Option<[f64; 8]> {
    expand_groups(value).map(|groups| groups.map(f64::from))
}

/// The four octets of a **canonical** dotted quad, or null.
///
/// Canonical only: a leading zero means octal to a resolver, so `010.0.0.1` must not read as
/// `10.0.0.1`.
fn parse_ipv4(value: &str) -> Option<[u32; 4]> {
    let parts: Vec<&str> = value.split('.').collect();
    let [a, b, c, d] = <[&str; 4]>::try_from(parts).ok()?;
    Some([
        canonical_octet(a)?,
        canonical_octet(b)?,
        canonical_octet(c)?,
        canonical_octet(d)?,
    ])
}

fn canonical_octet(part: &str) -> Option<u32> {
    let shaped = part == "0"
        || (matches!(part.as_bytes(), [b'1'..=b'9', ..])
            && part.len() <= 3
            && part.bytes().all(|b| b.is_ascii_digit()));
    if !shaped {
        return None;
    }
    let octet = part.parse::<u32>().ok()?;
    (octet <= 255).then_some(octet)
}

fn is_public_ipv4(octets: [u32; 4]) -> bool {
    let [a, b, _, _] = octets;
    if a == 0 {
        return false; // "this network"
    }
    if a == 10 {
        return false; // private
    }
    if a == 127 {
        return false; // loopback
    }
    if a == 100 && (64..=127).contains(&b) {
        return false; // carrier-grade NAT
    }
    if a == 169 && b == 254 {
        return false; // link-local, and the metadata endpoint
    }
    if a == 172 && (16..=31).contains(&b) {
        return false; // private
    }
    if a == 192 && b == 0 {
        return false; // protocol assignments, including 192.0.0.192
    }
    if a == 192 && b == 168 {
        return false; // private
    }
    if a == 198 && (b == 18 || b == 19) {
        return false; // benchmarking
    }
    a < 224 // multicast, reserved, broadcast
}

/// The trailing `\d{1,3}(\.\d{1,3}){3}$` of an address, leftmost, as a byte offset.
fn trailing_quad_start(address: &str) -> Option<usize> {
    address
        .char_indices()
        .map(|(index, _)| index)
        .find(|&index| is_quad_shape(&address[index..]))
}

fn is_quad_shape(text: &str) -> bool {
    let parts: Vec<&str> = text.split('.').collect();
    parts.len() == 4
        && parts
            .iter()
            .all(|part| (1..=3).contains(&part.len()) && part.bytes().all(|b| b.is_ascii_digit()))
}

/// The eight 16-bit groups of an IPv6 address, or null.
///
/// Built by hand rather than pattern-matched on the text, because `URL` normalises what it is
/// given: `[::ffff:127.0.0.1]` comes back as `::ffff:7f00:1`.
fn expand_groups(value: &str) -> Option<[u32; 8]> {
    let lower = value.to_lowercase();
    let address = lower.split('%').next().unwrap_or("");
    if !address.contains(':') {
        return None;
    }

    // A trailing dotted quad is the last two groups written in IPv4.
    let (head, tail) = match trailing_quad_start(address) {
        Some(start) => {
            let [a, b, c, d] = parse_ipv4(&address[start..])?;
            (&address[..start], vec![(a << 8) | b, (c << 8) | d])
        }
        None => (address, Vec::new()),
    };

    let halves: Vec<&str> = head.split("::").collect();
    if halves.len() > 2 {
        return None;
    }
    let left = hex_groups(halves.first().copied().unwrap_or(""))?;
    let right = match halves.get(1) {
        Some(part) => hex_groups(part)?,
        None => Vec::new(),
    };

    let mut groups = left;
    if halves.len() == 2 {
        let known = groups.len() + right.len() + tail.len();
        if known > 8 {
            return None;
        }
        groups.resize(groups.len() + 8 - known, 0);
        groups.extend(right);
    }
    groups.extend(tail);
    <[u32; 8]>::try_from(groups).ok()
}

fn hex_groups(part: &str) -> Option<Vec<u32>> {
    let mut groups = Vec::new();
    for piece in part.split(':').filter(|piece| !piece.is_empty()) {
        if piece.len() > 4 || !piece.bytes().all(|b| b.is_ascii_hexdigit()) {
            return None;
        }
        groups.push(u32::from_str_radix(piece, 16).ok()?);
    }
    Some(groups)
}

fn is_public_ipv6(address: &str) -> bool {
    let Some(groups) = expand_groups(address) else {
        return false;
    };
    let [g0, g1, g2, g3, g4, g5, g6, g7] = groups;

    // A v4-mapped (::ffff:0:0/96) or v4-compatible (::/96) address is an IPv4 address wearing a
    // hat, and the v4 rules are the ones that apply.
    let leading_zero = g0 == 0 && g1 == 0 && g2 == 0 && g3 == 0 && g4 == 0;
    if leading_zero && (g5 == 0xffff || g5 == 0) {
        if g6 == 0 && g7 == 0 {
            return false; // ::
        }
        if g5 == 0 && g6 == 0 && g7 == 1 {
            return false; // ::1
        }
        return is_public_ipv4([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff]);
    }

    if groups.iter().all(|&group| group == 0) {
        return false; // unspecified
    }
    if (g0 & 0xffc0) == 0xfe80 {
        return false; // link-local fe80::/10
    }
    if (g0 & 0xfe00) == 0xfc00 {
        return false; // unique local fc00::/7
    }
    if (g0 & 0xff00) == 0xff00 {
        return false; // multicast ff00::/8
    }
    if g0 == 0x2001 && g1 == 0x0db8 {
        return false; // documentation
    }
    if g0 == 0x2001 && (g1 & 0xfe00) == 0x0000 {
        return false; // 2001::/23 special-purpose
    }
    if g0 == 0x0064 && g1 == 0xff9b {
        return false; // NAT64, which translates to v4
    }
    if g0 == 0x2002 {
        return false; // 6to4, likewise
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_private_and_metadata_literals() {
        let loopback = check_url_shape("https:", false, "", "127.0.0.1");
        assert_eq!(loopback.reason, Some(UrlRejection::PrivateAddress));
        let metadata = check_url_shape("http:", false, "", "169.254.169.254");
        assert_eq!(metadata.reason, Some(UrlRejection::PrivateAddress));
        assert!(!is_public_address("010.0.0.1"));
    }

    #[test]
    fn refuses_v4_mapped_loopback_in_either_form() {
        assert!(!is_public_address("::ffff:127.0.0.1"));
        assert!(!is_public_address("::ffff:7f00:1"));
        assert!(is_public_address("::ffff:8.8.8.8"));
    }

    #[test]
    fn accepts_public_host_and_allowed_port() {
        let ok = check_url_shape("https:", false, "8443", "api.example.com");
        assert_eq!(
            ok,
            UrlCheck {
                ok: true,
                reason: None
            }
        );
        assert!(is_public_address("8.8.8.8"));
    }

    #[test]
    fn refuses_scheme_credentials_port_and_hostname_in_order() {
        assert_eq!(
            check_url_shape("ftp:", false, "", "example.com").reason,
            Some(UrlRejection::Scheme)
        );
        assert_eq!(
            check_url_shape("https:", true, "", "example.com").reason,
            Some(UrlRejection::Credentials)
        );
        assert_eq!(
            check_url_shape("https:", false, "3000", "example.com").reason,
            Some(UrlRejection::Port)
        );
        assert_eq!(
            check_url_shape("https:", false, "", "localhost").reason,
            Some(UrlRejection::Hostname)
        );
        assert_eq!(
            check_url_shape("https:", false, "", "intranet").reason,
            Some(UrlRejection::Hostname)
        );
    }

    #[test]
    fn expands_compressed_ipv6() {
        assert_eq!(
            expand_ipv6("::1"),
            Some([0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0])
        );
        assert_eq!(expand_ipv6("1:2:3:4:5:6:7:8:9"), None);
        assert_eq!(expand_ipv6("not:an:address"), None);
    }

    #[test]
    fn bracketed_ipv6_literal_is_checked() {
        assert_eq!(
            check_url_shape("https:", false, "", "[::1]").reason,
            Some(UrlRejection::PrivateAddress)
        );
        assert!(is_ip_address("2606:4700::1111"));
    }
}
