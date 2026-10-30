//! Tests for which hosts and addresses a relay may fetch from (ported from url-safety.ts).

use weaveforge_shell::relay::address::{is_ip_address, is_private_host, is_public_address};

#[test]
fn public_v4_allowed() {
    const CASES: &[&str] = &[
        "8.8.8.8",
        "1.1.1.1",
        "93.184.216.34",
        "172.15.255.255",
        "172.32.0.1",
        "100.63.255.255",
        "100.128.0.1",
        "169.253.1.1",
        "192.1.0.1",
        "198.17.0.1",
        "198.20.0.1",
        "223.255.255.255",
    ];
    for case in CASES {
        assert!(is_public_address(case), "{case}");
    }
}

#[test]
fn private_v4_refused() {
    const CASES: &[&str] = &[
        "0.0.0.0",
        "0.1.2.3",
        "10.0.0.1",
        "10.255.255.255",
        "127.0.0.1",
        "127.1.2.3",
        "100.64.0.1",
        "100.127.255.255",
        "169.254.169.254",
        "169.254.0.1",
        "172.16.0.1",
        "172.31.255.255",
        "192.0.0.192",
        "192.0.2.1",
        "192.168.1.1",
        "198.18.0.1",
        "198.19.255.255",
        "224.0.0.1",
        "239.255.255.255",
        "240.0.0.1",
        "255.255.255.255",
    ];
    for case in CASES {
        assert!(!is_public_address(case), "{case}");
    }
}

#[test]
fn non_canonical_v4_refused() {
    // Not canonical dotted quads: refused as addresses and not treated as IP literals.
    const CASES: &[&str] = &[
        "010.0.0.1",
        "01.2.3.4",
        "127.1",
        "2130706433",
        "0x7f.0.0.1",
        "1.2.3.256",
        "1.2.3",
        "1.2.3.4.5",
        " 1.2.3.4",
        "1.2.3.4 ",
        "",
    ];
    for case in CASES {
        assert!(!is_public_address(case), "{case}");
        assert!(!is_ip_address(case), "{case}");
    }
}

#[test]
fn public_v6_allowed() {
    const CASES: &[&str] = &[
        "2606:4700:4700::1111",
        "2001:4860:4860::8888",
        "2a00:1450:4001::1",
        "2001:200::1",
        "2003::1",
        "64:ff9a::1",
        "::ffff:8.8.8.8",
        "::ffff:808:808",
        "2606:4700:4700::1111%eth0",
        "2606:4700:4700:0:0:0:0:1111",
        "2606:4700:4700::ABCD",
    ];
    for case in CASES {
        assert!(is_public_address(case), "{case}");
    }
}

#[test]
fn private_v6_refused() {
    const CASES: &[&str] = &[
        "::",
        "::1",
        "0:0:0:0:0:0:0:1",
        "fe80::1",
        "febf::1",
        "fe80::1%eth0",
        "fc00::1",
        "fd12:3456::1",
        "ff02::1",
        "ff00::1",
        "2001:db8::1",
        "2001::1",
        "2001:1ff::1",
        "64:ff9b::1.2.3.4",
        "64:ff9b::808:808",
        "2002:c0a8:101::1",
        "::ffff:127.0.0.1",
        "::ffff:7f00:1",
        "::ffff:10.0.0.1",
        "::ffff:169.254.169.254",
        "::127.0.0.1",
        "::ffff:0.0.0.0",
        "::ffff:0:0",
    ];
    for case in CASES {
        assert!(!is_public_address(case), "{case}");
    }
}

#[test]
fn malformed_v6_refused_but_counts_as_ip() {
    const CASES: &[&str] = &[
        "not:an:address",
        "1:2:3:4:5:6:7:8:9",
        "1::2::3",
        "12345::1",
        "::ffff:1.2.3.256",
        ":",
        "gggg::1",
    ];
    for case in CASES {
        assert!(is_ip_address(case), "{case}");
        assert!(!is_public_address(case), "{case}");
    }
}

#[test]
fn is_ip_address_rejects_names() {
    const NOT_IP: &[&str] = &["example.com", "localhost", "", "1.2.3"];
    const IP: &[&str] = &["8.8.8.8", "::1", "[::1]"];
    for case in NOT_IP {
        assert!(!is_ip_address(case), "{case}");
    }
    // "[::1]" contains ':' so it counts as IP, matching the TS.
    for case in IP {
        assert!(is_ip_address(case), "{case}");
    }
}

#[test]
fn private_host_names() {
    const PRIVATE: &[&str] = &[
        "localhost",
        "LOCALHOST",
        "localhost.",
        "app.localhost",
        "a.b.localhost",
        "[::1]",
        "[fe80::1]",
        "127.0.0.1",
        "10.0.0.1",
        "169.254.169.254",
        "[::ffff:7f00:1]",
    ];
    const PUBLIC: &[&str] = &[
        "example.com",
        "notlocalhost",
        "localhost.example.com",
        "8.8.8.8",
        "[2606:4700:4700::1111]",
        // Empty is not private here; the URL check refuses empty hosts elsewhere.
        "",
    ];
    for case in PRIVATE {
        assert!(is_private_host(case), "{case}");
    }
    for case in PUBLIC {
        assert!(!is_private_host(case), "{case}");
    }
}

#[test]
fn bracket_strip_needs_both() {
    // Only a matched pair of brackets is stripped. Unmatched forms fail to parse,
    // so they are not public and count as private: the safe direction.
    const CASES: &[&str] = &["[::1", "::1]"];
    for case in CASES {
        assert!(is_ip_address(case), "{case}");
        assert!(!is_public_address(case), "{case}");
        assert!(is_private_host(case), "{case}");
    }
}
