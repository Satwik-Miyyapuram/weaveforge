//! Pins the lab invite code rules: format, normalize, generate from bytes, name check and join rules.

#![allow(clippy::unwrap_used, clippy::expect_used, missing_docs)]

use wf_core::org::{
    format_invite_code, invite_code_from_bytes, normalize_invite_code, resolve_join_assignment,
    validate_org_name,
};

fn ids(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| (*s).to_owned()).collect()
}

#[test]
fn from_bytes_matches_ts_vectors() {
    assert_eq!(invite_code_from_bytes(&[0; 10]), "000-000-000");
    assert_eq!(invite_code_from_bytes(&[255; 10]), "ZZZ-ZZZ-ZZZ");
    assert_eq!(
        invite_code_from_bytes(&[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
        "410-610-50R"
    );
}

#[test]
fn normalize_strips_separators_and_maps_typos() {
    assert_eq!(normalize_invite_code("abc-def-ghj"), "ABCDEFGHJ");
    assert_eq!(normalize_invite_code("  il o-1 "), "1101");
    assert_eq!(normalize_invite_code("x\ty"), "XY");
    assert_eq!(normalize_invite_code("ÄbC-ïl"), "ÄBCÏ1");
}

#[test]
fn format_keeps_alphanumerics_and_groups_by_three() {
    assert_eq!(format_invite_code("ab-c"), "ABC");
    assert_eq!(format_invite_code("a_b c!d"), "ABC-D");
    assert_eq!(format_invite_code("abcdefg"), "ABC-DEF-G");
    assert_eq!(format_invite_code(""), "");
}

#[test]
fn validate_trims_and_counts_utf16_units() {
    assert_eq!(validate_org_name("  Lab  "), Ok("Lab".to_owned()));
    assert_eq!(validate_org_name("   "), Err("Lab name is required."));
    assert!(validate_org_name(&"é".repeat(120)).is_ok());
    assert_eq!(
        validate_org_name(&"a".repeat(121)),
        Err("Lab name is too long.")
    );
    // 60 emoji are 120 UTF-16 units, which is the limit.
    assert!(validate_org_name(&"😀".repeat(60)).is_ok());
    assert_eq!(
        validate_org_name(&"😀".repeat(61)),
        Err("Lab name is too long.")
    );
}

#[test]
fn professor_join_has_no_supervisor() {
    let assignment = resolve_join_assignment("professor", &[], &[], None, None).unwrap();
    assert_eq!(assignment.role, "professor");
    assert_eq!(assignment.supervisor_id, None);
}

#[test]
fn phd_with_one_professor_ignores_input() {
    let profs = ids(&["p1"]);
    let assignment = resolve_join_assignment("phd", &profs, &[], Some("other"), None).unwrap();
    assert_eq!(assignment.role, "phd");
    assert_eq!(assignment.supervisor_id.as_deref(), Some("p1"));
    let assignment = resolve_join_assignment("phd", &profs, &[], None, None).unwrap();
    assert_eq!(assignment.supervisor_id.as_deref(), Some("p1"));
}

#[test]
fn phd_with_two_professors_needs_a_listed_id() {
    let profs = ids(&["p1", "p2"]);
    let ok = resolve_join_assignment("phd", &profs, &[], Some("p2"), None).unwrap();
    assert_eq!(ok.supervisor_id.as_deref(), Some("p2"));
    let err = "Choose a professor supervisor for this lab.";
    assert_eq!(
        resolve_join_assignment("phd", &profs, &[], None, None),
        Err(err)
    );
    assert_eq!(
        resolve_join_assignment("phd", &profs, &[], Some("zz"), None),
        Err(err)
    );
    assert_eq!(
        resolve_join_assignment("phd", &profs, &[], Some(""), None),
        Err(err)
    );
}

#[test]
fn masters_needs_a_listed_phd_supervisor() {
    let phds = ids(&["d1"]);
    let ok = resolve_join_assignment("masters", &[], &phds, None, Some("d1")).unwrap();
    assert_eq!(ok.role, "masters");
    assert_eq!(ok.supervisor_id.as_deref(), Some("d1"));
    let err = "Choose a PhD supervisor in this lab.";
    assert_eq!(
        resolve_join_assignment("masters", &[], &phds, None, None),
        Err(err)
    );
    assert_eq!(
        resolve_join_assignment("masters", &[], &phds, None, Some("x")),
        Err(err)
    );
}

#[test]
fn unknown_role_is_rejected() {
    assert_eq!(
        resolve_join_assignment("admin", &[], &[], None, None),
        Err("Unknown invite type.")
    );
}
