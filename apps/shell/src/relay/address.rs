//! Which hosts and addresses a relay may fetch from. Ported from packages/core/src/net/url-safety.ts and isPrivateHost in apps/desktop/src/proxy-shared.ts.

use std::net::{Ipv4Addr, Ipv6Addr};
use std::str::FromStr;

/// True when `value` is an IPv4 dotted quad or looks like IPv6 (contains `:`).
/// Loose on purpose, like the TS: a string with a colon that is not IPv6 is then refused by `is_public_address`.
#[must_use]
pub fn is_ip_address(value: &str) -> bool {
    Ipv4Addr::from_str(value).is_ok() || value.contains(':')
}

/// True when the address is one the internet routes to someone else; private, reserved,
/// local, special-purpose and unparseable addresses are all false.
#[must_use]
pub fn is_public_address(address: &str) -> bool {
    if let Ok(v4) = Ipv4Addr::from_str(address) {
        return is_public_v4(v4);
    }
    address.contains(':') && is_public_v6(address)
}

/// True for `localhost`, `*.localhost`, and IP literals that are not public.
/// Lowercases, strips one pair of `[` `]` and one trailing `.` first, like the TS.
#[must_use]
pub fn is_private_host(host: &str) -> bool {
    let lower = host.to_ascii_lowercase();
    let mut h = lower.as_str();
    if let Some(inner) = h.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
        h = inner;
    }
    h = h.strip_suffix('.').unwrap_or(h);
    h == "localhost" || h.ends_with(".localhost") || (is_ip_address(h) && !is_public_address(h))
}

/// IPv4 rules from `isPublicIpv4`.
fn is_public_v4(addr: Ipv4Addr) -> bool {
    let [a, b, _, _] = addr.octets();
    !(a == 0
        || a == 10
        || a == 127
        || (a == 100 && (64..=127).contains(&b))
        || (a == 169 && b == 254)
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && b == 0)
        || (a == 192 && b == 168)
        || (a == 198 && (b == 18 || b == 19))
        || a >= 224)
}

/// IPv6 rules from `isPublicIpv6`. `address` may carry a `%zone` suffix.
fn is_public_v6(address: &str) -> bool {
    let unzoned = address.split('%').next().unwrap_or(address);
    let Ok(addr) = Ipv6Addr::from_str(unzoned) else {
        return false;
    };
    let [g0, g1, g2, g3, g4, g5, g6, g7] = addr.segments();

    // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) forms take the IPv4 rules.
    if g0 == 0 && g1 == 0 && g2 == 0 && g3 == 0 && g4 == 0 && (g5 == 0xffff || g5 == 0) {
        if g6 == 0 && g7 == 0 {
            return false;
        }
        if g5 == 0 && g6 == 0 && g7 == 1 {
            return false;
        }
        let embedded = Ipv4Addr::from((u32::from(g6) << 16) | u32::from(g7));
        return is_public_v4(embedded);
    }

    if g0 == 0 && g1 == 0 && g2 == 0 && g3 == 0 && g4 == 0 && g5 == 0 && g6 == 0 && g7 == 0 {
        return false;
    }
    if (g0 & 0xffc0) == 0xfe80 || (g0 & 0xfe00) == 0xfc00 || (g0 & 0xff00) == 0xff00 {
        return false;
    }
    if g0 == 0x2001 && g1 == 0x0db8 {
        return false;
    }
    // 2001::/23 (IETF protocol assignments). The TS isPublicIpv6 masks 0xff00 (only a /24);
    // this is the correct /23 and refuses more, on purpose.
    if g0 == 0x2001 && (g1 & 0xfe00) == 0 {
        return false;
    }
    if g0 == 0x0064 && g1 == 0xff9b {
        return false;
    }
    g0 != 0x2002
}
