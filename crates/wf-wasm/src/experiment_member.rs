//! Experiment creation and member role labels for JavaScript (wf-core `experiments` and
//! `member`). The JS names match `packages/core/src/features/experiments/domain/parts.ts`
//! and `packages/core/src/features/org/domain/parts.ts`.

use serde::Deserialize;
use wasm_bindgen::prelude::wasm_bindgen;
use wasm_bindgen::{JsCast, JsValue};
use wf_core::experiments::{self, NewExperimentInput};
use wf_core::member::{self, MemberRole};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// `error` as a JS value named `name`: an unnamed `Error` (name `"Error"`) is renamed, a string
/// becomes an `Error` with that message and name, anything else passes through unchanged.
pub(crate) fn named_error(error: serde_wasm_bindgen::Error, name: &str) -> JsValue {
    let value = JsValue::from(error);
    if let Some(thrown) = value.dyn_ref::<js_sys::Error>() {
        if thrown.name() == "Error" {
            thrown.set_name(name);
        }
        return value;
    }
    match value.as_string() {
        Some(message) => {
            let thrown = js_sys::Error::new(&message);
            thrown.set_name(name);
            thrown.into()
        }
        None => value,
    }
}

/// The text `deps[holder][method]()` returns, called on `deps[holder]` like TS
/// `deps.clock.nowIso()`.
///
/// # Errors
///
/// Rethrows whatever reading the field or calling the method throws.
pub(crate) fn dep_text(deps: &JsValue, holder: &str, method: &str) -> Result<String, JsValue> {
    let target = js_sys::Reflect::get(deps, &JsValue::from_str(holder))?;
    let call: js_sys::Function =
        js_sys::Reflect::get(&target, &JsValue::from_str(method))?.unchecked_into();
    Ok(call.call0(&target)?.as_string().unwrap_or_default())
}

/// [`create_experiment`](experiments::create_experiment) with the id and time supplied. Invalid
/// input fails with the TS validation message.
///
/// # Errors
///
/// Fails if `input` has the wrong shape or its name is blank.
#[wasm_bindgen(js_name = createExperimentWith, unchecked_return_type = "B.Experiment")]
pub fn create_experiment_with_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] input: JsValue,
    id: &str,
    now: &str,
) -> JsResult<JsValue> {
    let input: NewExperimentInput = serde_wasm_bindgen::from_value(input)?;
    let made =
        experiments::create_experiment(&input, id, now).map_err(serde_wasm_bindgen::Error::new)?;
    to_js(&made)
}

/// A new experiment, its time from `deps.clock.nowIso()` and then its id from
/// `deps.ids.newId()`.
///
/// # Errors
///
/// Throws an `ExperimentValidationError` for a blank name or a wrongly shaped `input`, and
/// rethrows whatever `deps` throws.
#[wasm_bindgen(js_name = createExperiment, unchecked_return_type = "B.Experiment")]
#[allow(clippy::needless_pass_by_value)] // wasm-bindgen needs owned arguments.
pub fn create_experiment_js(
    #[wasm_bindgen(unchecked_param_type = "unknown")] input: JsValue,
    #[wasm_bindgen(
        unchecked_param_type = "{ clock: { nowIso(): string }; ids: { newId(): string } }"
    )]
    deps: JsValue,
) -> Result<JsValue, JsValue> {
    let now = dep_text(&deps, "clock", "nowIso")?;
    let id = dep_text(&deps, "ids", "newId")?;
    create_experiment_with_js(input, &id, &now)
        .map_err(|error| named_error(error, "ExperimentValidationError"))
}

/// [`member_role_label`](member::member_role_label): the label, or `undefined` when the role has none.
///
/// # Errors
///
/// Fails if `member` has the wrong shape.
#[wasm_bindgen(js_name = memberRoleLabelOf)]
pub fn member_role_label_js(
    #[wasm_bindgen(unchecked_param_type = "{ role: string }")] member: JsValue,
    in_lab: bool,
    owns_org: bool,
) -> JsResult<Option<String>> {
    let member: MemberRole = serde_wasm_bindgen::from_value(member)?;
    Ok(member::member_role_label(&member, in_lab, owns_org).map(str::to_owned))
}

/// The options of `memberRoleLabel`; a missing or `null` `ownsOrg` reads as `false`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RoleLabelOptions {
    in_lab: bool,
    #[serde(default)]
    owns_org: Option<bool>,
}

/// [`member_role_label`](member::member_role_label): the label shown for a member's role, or
/// `""` when the role has none.
///
/// # Errors
///
/// Fails if `member` or `opts` has the wrong shape.
#[wasm_bindgen(js_name = memberRoleLabel)]
pub fn member_role_label_or_empty_js(
    #[wasm_bindgen(unchecked_param_type = "{ role: string }")] member: JsValue,
    #[wasm_bindgen(unchecked_param_type = "{ inLab: boolean; ownsOrg?: boolean }")] opts: JsValue,
) -> JsResult<String> {
    let opts: RoleLabelOptions = serde_wasm_bindgen::from_value(opts)?;
    Ok(
        member_role_label_js(member, opts.in_lab, opts.owns_org.unwrap_or(false))?
            .unwrap_or_default(),
    )
}
