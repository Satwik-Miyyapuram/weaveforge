//! wasm exports for `integrations::{config, gates}` (TS: `integration-config.ts`).

use wasm_bindgen::JsValue;
use wasm_bindgen::prelude::wasm_bindgen;
use wf_core::integrations::config::{
    IntegrationConfig, IntegrationEnv, ProviderIds, resolve_integration_config,
};
use wf_core::integrations::gates::{
    RuntimeGate, gitlab_combined_active, project_gate_open, user_gate_open,
};

use super::to_js;

/// [`resolve_integration_config`]. `env` is the five `NEXT_PUBLIC_*` provider values, `ids`
/// the registered ids per kind.
///
/// # Errors
///
/// Fails if an argument has the wrong shape, or the result cannot be converted to JS.
#[wasm_bindgen(js_name = resolveIntegrationConfig)]
pub fn resolve_integration_config_js(
    env: JsValue,
    ids: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let env: IntegrationEnv = serde_wasm_bindgen::from_value(env)?;
    let ids: ProviderIds = serde_wasm_bindgen::from_value(ids)?;
    to_js(&resolve_integration_config(&env, &ids))
}

/// [`user_gate_open`]. `gate` is `null` or `undefined` for an ungated descriptor.
///
/// # Errors
///
/// Fails if an argument has the wrong shape, or the result cannot be converted to JS.
#[wasm_bindgen(js_name = userGateOpen)]
pub fn user_gate_open_js(
    config: JsValue,
    gate: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let config: IntegrationConfig = serde_wasm_bindgen::from_value(config)?;
    let gate: Option<RuntimeGate> = serde_wasm_bindgen::from_value(gate)?;
    to_js(&user_gate_open(&config, gate.as_ref()))
}

/// [`project_gate_open`].
///
/// # Errors
///
/// Fails if an argument has the wrong shape, or the result cannot be converted to JS.
#[wasm_bindgen(js_name = projectGateOpen)]
pub fn project_gate_open_js(
    config: JsValue,
    gate: JsValue,
) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let config: IntegrationConfig = serde_wasm_bindgen::from_value(config)?;
    let gate: RuntimeGate = serde_wasm_bindgen::from_value(gate)?;
    to_js(&project_gate_open(&config, &gate))
}

/// [`gitlab_combined_active`].
///
/// # Errors
///
/// Fails if `config` has the wrong shape, or the result cannot be converted to JS.
#[wasm_bindgen(js_name = gitlabCombinedActive)]
pub fn gitlab_combined_active_js(config: JsValue) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let config: IntegrationConfig = serde_wasm_bindgen::from_value(config)?;
    to_js(&gitlab_combined_active(&config))
}
