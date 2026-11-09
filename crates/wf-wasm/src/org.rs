//! Lab member and org rules for JavaScript (wf-core `member` and `org`). The JS names match
//! the functions in `packages/core/src/features/org/domain/` and `.../org/application/`
//! that they replace.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::member::{self, MemberLink, ProfileState, TeamVisibility};
use wf_core::org::{self, Membership, OrgSetupState};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`creatable_roles`](member::creatable_roles).
#[wasm_bindgen(js_name = creatableRoles)]
pub fn creatable_roles_js(creator: &str) -> JsResult<JsValue> {
    to_js(&member::creatable_roles(creator))
}

/// [`filter_team_members`](member::filter_team_members). Returns indices into `members`.
///
/// # Errors
///
/// Fails if `members` or `options` has the wrong shape.
#[wasm_bindgen(js_name = filterTeamMembers)]
pub fn filter_team_members_js(
    viewer_id: &str,
    members: JsValue,
    options: JsValue,
) -> JsResult<JsValue> {
    let members: Vec<MemberLink> = serde_wasm_bindgen::from_value(members)?;
    let options: TeamVisibility = serde_wasm_bindgen::from_value(options)?;
    to_js(&member::filter_team_members(viewer_id, &members, &options))
}

/// [`filter_lab_members`](member::filter_lab_members). Returns indices into `members`.
///
/// # Errors
///
/// Fails if `members` or `options` has the wrong shape.
#[wasm_bindgen(js_name = filterLabMembers)]
pub fn filter_lab_members_js(
    viewer_id: &str,
    members: JsValue,
    options: JsValue,
) -> JsResult<JsValue> {
    let members: Vec<MemberLink> = serde_wasm_bindgen::from_value(members)?;
    let options: TeamVisibility = serde_wasm_bindgen::from_value(options)?;
    to_js(&member::filter_lab_members(viewer_id, &members, &options))
}

/// [`students_of`](member::students_of). Returns indices into `team`.
///
/// # Errors
///
/// Fails if `team` has the wrong shape.
#[wasm_bindgen(js_name = studentsOf)]
pub fn students_of_js(viewer_id: Option<String>, team: JsValue) -> JsResult<JsValue> {
    let team: Vec<MemberLink> = serde_wasm_bindgen::from_value(team)?;
    to_js(&member::students_of(viewer_id.as_deref(), &team))
}

/// [`is_supervisor_role`](member::is_supervisor_role).
#[wasm_bindgen(js_name = isSupervisorRole)]
#[must_use]
pub fn is_supervisor_role_js(role: Option<String>) -> bool {
    member::is_supervisor_role(role.as_deref())
}

/// [`resolve_display_role`](member::resolve_display_role).
#[wasm_bindgen(js_name = resolveDisplayRole)]
#[must_use]
pub fn resolve_display_role_js(role: &str, in_lab: bool, owns_org: bool) -> String {
    member::resolve_display_role(role, in_lab, owns_org).to_owned()
}

/// [`needs_standalone_role_sync`](member::needs_standalone_role_sync).
///
/// # Errors
///
/// Fails if `profile` or `memberships` has the wrong shape.
#[wasm_bindgen(js_name = needsStandaloneRoleSync)]
pub fn needs_standalone_role_sync_js(
    profile: JsValue,
    memberships: JsValue,
    in_lab: bool,
) -> JsResult<bool> {
    let profile: Option<ProfileState> = serde_wasm_bindgen::from_value(profile)?;
    let memberships: Vec<Membership> = serde_wasm_bindgen::from_value(memberships)?;
    Ok(member::needs_standalone_role_sync(
        profile.as_ref(),
        &memberships,
        in_lab,
    ))
}

/// [`is_explicit_lab_membership`](org::is_explicit_lab_membership).
///
/// # Errors
///
/// Fails if `membership` has the wrong shape.
#[wasm_bindgen(js_name = isExplicitLabMembership)]
pub fn is_explicit_lab_membership_js(membership: JsValue) -> JsResult<bool> {
    let membership: Membership = serde_wasm_bindgen::from_value(membership)?;
    Ok(org::is_explicit_lab_membership(&membership))
}

/// [`has_active_lab`](org::has_active_lab).
///
/// # Errors
///
/// Fails if `memberships` has the wrong shape.
#[wasm_bindgen(js_name = hasActiveLab)]
pub fn has_active_lab_js(
    active_org_id: Option<String>,
    memberships: JsValue,
    owns_active_org: bool,
) -> JsResult<bool> {
    let memberships: Vec<Membership> = serde_wasm_bindgen::from_value(memberships)?;
    Ok(org::has_active_lab(
        active_org_id.as_deref(),
        &memberships,
        owns_active_org,
    ))
}

/// [`should_sync_standalone`](org::should_sync_standalone). `labs` is `null` when the
/// memberships could not be read.
///
/// # Errors
///
/// Fails if `profile` or `labs` has the wrong shape.
#[wasm_bindgen(js_name = shouldSyncStandalone)]
pub fn should_sync_standalone_js(profile: JsValue, labs: JsValue) -> JsResult<bool> {
    let profile: Option<ProfileState> = serde_wasm_bindgen::from_value(profile)?;
    let labs: Option<Vec<Membership>> = serde_wasm_bindgen::from_value(labs)?;
    Ok(org::should_sync_standalone(
        profile.as_ref(),
        labs.as_deref(),
    ))
}

/// [`needs_org_setup`](org::needs_org_setup).
///
/// # Errors
///
/// Fails if `state` has the wrong shape.
#[wasm_bindgen(js_name = needsOrgSetup)]
pub fn needs_org_setup_js(state: JsValue) -> JsResult<bool> {
    let state: OrgSetupState = serde_wasm_bindgen::from_value(state)?;
    Ok(org::needs_org_setup(&state))
}

/// [`can_create_role`](member::can_create_role).
#[wasm_bindgen(js_name = canCreateRole)]
#[must_use]
pub fn can_create_role_js(creator: &str, target: &str) -> bool {
    member::can_create_role(creator, target)
}

/// [`resolve_supervisor_id`](member::resolve_supervisor_id).
#[wasm_bindgen(js_name = resolveSupervisorId)]
#[must_use]
pub fn resolve_supervisor_id_js(creator_id: &str) -> String {
    member::resolve_supervisor_id(creator_id)
}

/// [`validate_new_member`](member::validate_new_member). Throws the validation message.
///
/// # Errors
///
/// Fails with the message if the request is invalid.
#[wasm_bindgen(js_name = validateNewMember)]
pub fn validate_new_member_js(
    email: &str,
    password: &str,
    full_name: Option<String>,
    role: &str,
    supervisor_id: Option<String>,
) -> Result<JsValue, JsValue> {
    let member = member::validate_new_member(
        email,
        password,
        full_name.as_deref(),
        role,
        supervisor_id.as_deref(),
    )
    .map_err(|message| JsValue::from_str(&message))?;
    to_js(&member).map_err(|error| JsValue::from_str(&error.to_string()))
}

/// [`format_invite_code`](org::format_invite_code).
#[wasm_bindgen(js_name = formatInviteCode)]
#[must_use]
pub fn format_invite_code_js(raw: &str) -> String {
    org::format_invite_code(raw)
}

/// [`normalize_invite_code`](org::normalize_invite_code).
#[wasm_bindgen(js_name = normalizeOrgInviteCode)]
#[must_use]
pub fn normalize_org_invite_code_js(input: &str) -> String {
    org::normalize_invite_code(input)
}

/// [`validate_org_name`](org::validate_org_name). Throws the validation message.
///
/// # Errors
///
/// Fails with the message if the name is blank or too long.
#[wasm_bindgen(js_name = validateOrgName)]
pub fn validate_org_name_js(name: &str) -> Result<String, JsValue> {
    org::validate_org_name(name).map_err(JsValue::from_str)
}

/// [`resolve_join_assignment`](org::resolve_join_assignment). Returns `{ role, supervisorId }`.
///
/// # Errors
///
/// Fails with the message if the lab cannot take this invite type.
#[wasm_bindgen(js_name = resolveOrgJoinAssignment)]
pub fn resolve_org_join_assignment_js(
    target_role: &str,
    professor_ids: JsValue,
    phd_ids: JsValue,
    professor_supervisor_id: Option<String>,
    phd_supervisor_id: Option<String>,
) -> Result<JsValue, JsValue> {
    let professor_ids: Vec<String> = serde_wasm_bindgen::from_value(professor_ids)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let phd_ids: Vec<String> = serde_wasm_bindgen::from_value(phd_ids)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    let assignment = org::resolve_join_assignment(
        target_role,
        &professor_ids,
        &phd_ids,
        professor_supervisor_id.as_deref(),
        phd_supervisor_id.as_deref(),
    )
    .map_err(JsValue::from_str)?;
    to_js(&assignment).map_err(|error| JsValue::from_str(&error.to_string()))
}
