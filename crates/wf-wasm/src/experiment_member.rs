//! Experiment creation and member role labels for JavaScript (wf-core `experiments` and
//! `member`). The JS names match `packages/core/src/features/experiments/domain/parts.ts`
//! and `packages/core/src/features/org/domain/parts.ts`.

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::experiments::{self, NewExperimentInput};
use wf_core::member::{self, MemberRole};

use super::to_js;

type JsResult<T> = Result<T, serde_wasm_bindgen::Error>;

/// [`create_experiment`](experiments::create_experiment) with the id and time supplied. Invalid
/// input fails with the TS validation message.
///
/// # Errors
///
/// Fails if `input` has the wrong shape or its name is blank.
#[wasm_bindgen(js_name = createExperimentWith)]
pub fn create_experiment_with_js(input: JsValue, id: &str, now: &str) -> JsResult<JsValue> {
    let input: NewExperimentInput = serde_wasm_bindgen::from_value(input)?;
    let made =
        experiments::create_experiment(&input, id, now).map_err(serde_wasm_bindgen::Error::new)?;
    to_js(&made)
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
