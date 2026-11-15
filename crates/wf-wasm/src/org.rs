//! Lab member and org rules for JavaScript (wf-core `member` and `org`). The JS names match
//! the functions in `packages/core/src/features/org/domain/` and `.../org/application/`
//! that they replace.

#![allow(
    clippy::needless_pass_by_value,
    reason = "wasm-bindgen exports take owned values"
)]
use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::member::{self, MemberLink, ProfileState, TeamVisibility};
use wf_core::org::{self, Membership, OrgSetupState};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// The generic signatures of the exports that return members from the caller's array,
/// which wasm-bindgen cannot express.
#[wasm_bindgen(typescript_custom_section)]
const MEMBER_PICK_TS: &str = r"
/** The supervision team: the viewer plus all supervisees, at any depth. */
export function filterTeamMembers<T extends B.MemberLink>(
  viewerId: string,
  members: readonly T[],
  options: { inLab: boolean; orgMemberIds?: ReadonlySet<string> | null },
): T[];
/** The full active-lab roster, for the org chart. */
export function filterLabMembers<T extends B.MemberLink>(
  viewerId: string,
  members: readonly T[],
  options: { inLab: boolean; orgMemberIds?: ReadonlySet<string> | null },
): T[];
/** The people below `viewerId` in the supervisor tree, at any depth. */
export function studentsOf<T extends B.MemberLink>(viewerId: string | undefined, team: readonly T[]): T[];
";

/// `options` as [`TeamVisibility`]: `orgMemberIds` may be any iterable (a `Set`), and a
/// falsy one reads as unknown.
fn team_visibility(options: &JsValue) -> Result<TeamVisibility, JsValue> {
    let in_lab = js_sys::Reflect::get(options, &JsValue::from_str("inLab"))?;
    let ids = js_sys::Reflect::get(options, &JsValue::from_str("orgMemberIds"))?;
    let wire = js_sys::Object::new();
    let _ = js_sys::Reflect::set(&wire, &JsValue::from_str("inLab"), &in_lab)?;
    let ids = if ids.is_truthy() {
        js_sys::Array::from(&ids).into()
    } else {
        JsValue::NULL
    };
    let _ = js_sys::Reflect::set(&wire, &JsValue::from_str("orgMemberIds"), &ids)?;
    Ok(serde_wasm_bindgen::from_value(wire.into())?)
}

/// The items of `items` at `indices`, as a new JS array of the same objects.
fn pick(items: &JsValue, indices: &[usize]) -> Result<JsValue, JsValue> {
    let out = js_sys::Array::new();
    for &index in indices {
        let index =
            u32::try_from(index).map_err(|_| js_sys::RangeError::new("index out of range"))?;
        let _ = out.push(&js_sys::Reflect::get_u32(items, index)?);
    }
    Ok(out.into())
}

/// [`creatable_roles`](member::creatable_roles).
#[wasm_bindgen(js_name = creatableRoles, unchecked_return_type = "string[]")]
pub fn creatable_roles_js(creator: &str) -> JsResult<JsValue> {
    to_js(&member::creatable_roles(creator))
}

/// [`filter_team_members`](member::filter_team_members). Returns the picked objects of
/// `members` (the same objects, not copies).
///
/// # Errors
///
/// Fails if `members` or `options` has the wrong shape.
#[wasm_bindgen(js_name = filterTeamMembers, skip_typescript)]
pub fn filter_team_members_js(
    viewer_id: &str,
    members: JsValue,
    options: JsValue,
) -> Result<JsValue, JsValue> {
    let links: Vec<MemberLink> = serde_wasm_bindgen::from_value(members.clone())?;
    let options = team_visibility(&options)?;
    pick(
        &members,
        &member::filter_team_members(viewer_id, &links, &options),
    )
}

/// [`filter_lab_members`](member::filter_lab_members). Returns the picked objects of
/// `members` (the same objects, not copies).
///
/// # Errors
///
/// Fails if `members` or `options` has the wrong shape.
#[wasm_bindgen(js_name = filterLabMembers, skip_typescript)]
pub fn filter_lab_members_js(
    viewer_id: &str,
    members: JsValue,
    options: JsValue,
) -> Result<JsValue, JsValue> {
    let links: Vec<MemberLink> = serde_wasm_bindgen::from_value(members.clone())?;
    let options = team_visibility(&options)?;
    pick(
        &members,
        &member::filter_lab_members(viewer_id, &links, &options),
    )
}

/// [`students_of`](member::students_of). Returns the picked objects of `team` (the same
/// objects, not copies).
///
/// # Errors
///
/// Fails if `team` has the wrong shape.
#[wasm_bindgen(js_name = studentsOf, skip_typescript)]
pub fn students_of_js(viewer_id: Option<String>, team: JsValue) -> Result<JsValue, JsValue> {
    let links: Vec<MemberLink> = serde_wasm_bindgen::from_value(team.clone())?;
    pick(&team, &member::students_of(viewer_id.as_deref(), &links))
}

/// [`is_supervisor_role`](member::is_supervisor_role).
#[wasm_bindgen(js_name = isSupervisorRole)]
#[must_use]
pub fn is_supervisor_role_js(
    #[wasm_bindgen(unchecked_optional_param_type = "string | null | undefined")] role: Option<
        String,
    >,
) -> bool {
    member::is_supervisor_role(role.as_deref())
}

/// `opts` of [`resolve_display_role_js`].
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DisplayRoleOptions {
    in_lab: bool,
    #[serde(default)]
    owns_org: Option<bool>,
}

/// [`resolve_display_role`](member::resolve_display_role). `opts.ownsOrg` defaults to `false`.
///
/// # Errors
///
/// Fails if `opts` has the wrong shape.
#[wasm_bindgen(js_name = resolveDisplayRole)]
pub fn resolve_display_role_js(
    role: &str,
    #[wasm_bindgen(unchecked_param_type = "{ inLab: boolean; ownsOrg?: boolean }")] opts: JsValue,
) -> JsResult<String> {
    let opts: DisplayRoleOptions = serde_wasm_bindgen::from_value(opts)?;
    Ok(member::resolve_display_role(role, opts.in_lab, opts.owns_org.unwrap_or(false)).to_owned())
}

/// [`is_explicit_lab_membership`](org::is_explicit_lab_membership).
///
/// # Errors
///
/// Fails if `membership` has the wrong shape.
#[wasm_bindgen(js_name = isExplicitLabMembership)]
pub fn is_explicit_lab_membership_js(
    #[wasm_bindgen(unchecked_param_type = "B.Membership")] membership: JsValue,
) -> JsResult<bool> {
    let membership: Membership = serde_wasm_bindgen::from_value(membership)?;
    Ok(org::is_explicit_lab_membership(&membership))
}

/// [`needs_migration_hint`](org::needs_migration_hint).
#[wasm_bindgen(js_name = needsMigrationHint)]
pub fn needs_migration_hint_js(message: &str) -> bool {
    org::needs_migration_hint(message)
}

/// [`is_missing_service_role`](org::is_missing_service_role).
#[wasm_bindgen(js_name = isMissingServiceRole)]
pub fn is_missing_service_role_js(message: &str) -> bool {
    org::is_missing_service_role(message)
}

/// [`has_active_lab`](org::has_active_lab). `ownsActiveOrg` defaults to `false`.
///
/// # Errors
///
/// Fails if `memberships` has the wrong shape.
#[wasm_bindgen(js_name = hasActiveLab)]
pub fn has_active_lab_js(
    #[wasm_bindgen(unchecked_param_type = "string | null | undefined")] active_org_id: Option<
        String,
    >,
    #[wasm_bindgen(unchecked_param_type = "readonly B.Membership[]")] memberships: JsValue,
    owns_active_org: Option<bool>,
) -> JsResult<bool> {
    let memberships: Vec<Membership> = serde_wasm_bindgen::from_value(memberships)?;
    Ok(org::has_active_lab(
        active_org_id.as_deref(),
        &memberships,
        owns_active_org.unwrap_or(false),
    ))
}

/// [`should_sync_standalone`](org::should_sync_standalone). `labs` is `null` when the
/// memberships could not be read.
///
/// # Errors
///
/// Fails if `profile` or `labs` has the wrong shape.
#[wasm_bindgen(js_name = shouldSyncStandalone)]
pub fn should_sync_standalone_js(
    #[wasm_bindgen(unchecked_param_type = "B.ProfileState | null")] profile: JsValue,
    #[wasm_bindgen(unchecked_param_type = "readonly B.Membership[] | null")] labs: JsValue,
) -> JsResult<bool> {
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
pub fn needs_org_setup_js(
    #[wasm_bindgen(unchecked_param_type = "B.OrgSetupState")] state: JsValue,
) -> JsResult<bool> {
    let state: OrgSetupState = serde_wasm_bindgen::from_value(state)?;
    Ok(org::needs_org_setup(&state))
}

/// `input` of [`validate_new_member_js`].
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewMemberInput {
    email: String,
    password: String,
    #[serde(default)]
    full_name: Option<String>,
    role: String,
    #[serde(default)]
    supervisor_id: Option<String>,
}

/// [`validate_new_member`](member::validate_new_member): the normalized member, with
/// absent `fullName` / `supervisorId` set to `undefined` rather than `null`.
///
/// # Errors
///
/// Throws an `Error` named `MemberValidationError` with the message if the request is
/// invalid, or a shape error if `input` has the wrong shape.
#[wasm_bindgen(
    js_name = validateNewMember,
    unchecked_return_type = "Omit<B.NewMember, 'fullName' | 'supervisorId'> & { fullName?: string; supervisorId?: string }"
)]
pub fn validate_new_member_js(
    #[wasm_bindgen(
        unchecked_param_type = "Pick<B.NewMember, 'email' | 'password' | 'role'> & Partial<Pick<B.NewMember, 'fullName' | 'supervisorId'>>"
    )]
    input: JsValue,
) -> Result<JsValue, JsValue> {
    let input: NewMemberInput = serde_wasm_bindgen::from_value(input)?;
    let member = member::validate_new_member(
        &input.email,
        &input.password,
        input.full_name.as_deref(),
        &input.role,
        input.supervisor_id.as_deref(),
    )
    .map_err(|message| {
        let error = js_sys::Error::new(&message);
        error.set_name("MemberValidationError");
        JsValue::from(error)
    })?;
    // The default serializer writes `None` as `undefined` (the key stays, like `?? undefined`).
    Ok(serde::Serialize::serialize(
        &member,
        &serde_wasm_bindgen::Serializer::new(),
    )?)
}
