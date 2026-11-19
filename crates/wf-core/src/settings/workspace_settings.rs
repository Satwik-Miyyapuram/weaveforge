//! The workspace's `.weaveforge/settings.json`: its id and sharing tier (modes-093 section 1).
//! Pure: the caller reads and writes the file. Fields this module does not own are kept on rewrite.

use serde_json::{Map, Value};

use crate::sync::tier_merge::{Tier, TierFields};

/// Path of the settings file, relative to the workspace folder.
pub const SETTINGS_PATH: &str = ".weaveforge/settings.json";

const WORKSPACE_ID: &str = "workspaceId";
const TIER: &str = "tier";
const TIER_EPOCH: &str = "tierEpoch";
const TIER_ACCOUNT: &str = "tierAccount";
const SERVER_HINT: &str = "serverHint";
const OWNED: [&str; 5] = [WORKSPACE_ID, TIER, TIER_EPOCH, TIER_ACCOUNT, SERVER_HINT];

/// Why a settings file cannot be read. The caller then leaves the file as it is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SettingsError {
    /// The text is not a JSON object.
    Malformed,
    /// The named field holds a value of the wrong type or an unknown tier.
    BadField(&'static str),
}

/// The parsed settings file: identity and tier, plus the fields this module does not own.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceSettings {
    /// Identity, sharing tier, epoch and the account that set the tier.
    pub tier: TierFields,
    /// Host name of the server profile used to raise the tier.
    pub server_hint: Option<String>,
    /// Fields this module does not own, written back unchanged.
    other: Map<String, Value>,
}

impl WorkspaceSettings {
    /// Settings for a folder that has no file yet: Local, epoch 0, no id.
    #[must_use]
    pub fn new_folder() -> Self {
        Self {
            tier: TierFields {
                workspace_id: None,
                tier: Tier::Local,
                tier_epoch: 0,
                tier_account: None,
            },
            server_hint: None,
            other: Map::new(),
        }
    }

    /// Reads the settings text.
    ///
    /// # Errors
    /// Not a JSON object, or an owned field holds a value of the wrong type.
    pub fn parse(text: &str) -> Result<Self, SettingsError> {
        let Value::Object(mut map) =
            serde_json::from_str::<Value>(text).map_err(|_| SettingsError::Malformed)?
        else {
            return Err(SettingsError::Malformed);
        };
        let tier = TierFields {
            workspace_id: text_field(&map, WORKSPACE_ID)?,
            tier: tier_field(&map)?,
            tier_epoch: epoch_field(&map)?,
            tier_account: text_field(&map, TIER_ACCOUNT)?,
        };
        let server_hint = text_field(&map, SERVER_HINT)?;
        map.retain(|key, _| !OWNED.contains(&key.as_str()));
        Ok(Self {
            tier,
            server_hint,
            other: map,
        })
    }

    /// The file text: the unowned fields as they were, then the owned fields.
    ///
    /// # Errors
    /// Only if serialising the JSON fails, which should not happen for these values.
    pub fn to_text(&self) -> Result<String, serde_json::Error> {
        let mut map = self.other.clone();
        map.extend([
            (
                WORKSPACE_ID.to_owned(),
                optional_text(&self.tier.workspace_id),
            ),
            (
                TIER.to_owned(),
                Value::String(tier_name(self.tier.tier).to_owned()),
            ),
            (TIER_EPOCH.to_owned(), Value::from(self.tier.tier_epoch)),
            (
                TIER_ACCOUNT.to_owned(),
                optional_text(&self.tier.tier_account),
            ),
            (SERVER_HINT.to_owned(), optional_text(&self.server_hint)),
        ]);
        let mut text = serde_json::to_string_pretty(&Value::Object(map))?;
        text.push('\n');
        Ok(text)
    }

    /// Gives the folder `fresh` as its id when it has none. A stored id is kept.
    /// Returns true when it stamped the id, so the caller knows to write the file.
    pub fn ensure_workspace_id(&mut self, fresh: &str) -> bool {
        if self.tier.workspace_id.is_some() {
            return false;
        }
        self.tier.workspace_id = Some(fresh.to_owned());
        true
    }

    /// Moves the workspace to `tier`, set by `account` on the server named by `server_hint`.
    /// Any change bumps `tierEpoch` by one, so other devices see it as the newer decision.
    /// Returns false, and changes nothing, when all three already match.
    pub fn set_tier(
        &mut self,
        tier: Tier,
        account: Option<&str>,
        server_hint: Option<&str>,
    ) -> bool {
        if self.tier.tier == tier
            && self.tier.tier_account.as_deref() == account
            && self.server_hint.as_deref() == server_hint
        {
            return false;
        }
        self.tier.tier = tier;
        self.tier.tier_account = account.map(str::to_owned);
        self.server_hint = server_hint.map(str::to_owned);
        self.tier.tier_epoch = self.tier.tier_epoch.saturating_add(1);
        true
    }
}

/// A string field. Absent, null and empty all read as `None`.
fn text_field(
    map: &Map<String, Value>,
    key: &'static str,
) -> Result<Option<String>, SettingsError> {
    match map.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) if text.is_empty() => Ok(None),
        Some(Value::String(text)) => Ok(Some(text.clone())),
        Some(_) => Err(SettingsError::BadField(key)),
    }
}

/// The tier. Absent or null is Local; any other unknown name is refused, never read as Local.
fn tier_field(map: &Map<String, Value>) -> Result<Tier, SettingsError> {
    match map.get(TIER) {
        None | Some(Value::Null) => Ok(Tier::Local),
        Some(Value::String(name)) => tier_from_name(name).ok_or(SettingsError::BadField(TIER)),
        Some(_) => Err(SettingsError::BadField(TIER)),
    }
}

/// The epoch, a non-negative integer. Absent or null is 0.
fn epoch_field(map: &Map<String, Value>) -> Result<u64, SettingsError> {
    match map.get(TIER_EPOCH) {
        None | Some(Value::Null) => Ok(0),
        Some(value) => value.as_u64().ok_or(SettingsError::BadField(TIER_EPOCH)),
    }
}

fn optional_text(value: &Option<String>) -> Value {
    value.clone().map_or(Value::Null, Value::String)
}

/// The file name of a tier: "local", "local-web" or "sharing".
pub fn tier_name(tier: Tier) -> &'static str {
    match tier {
        Tier::Local => "local",
        Tier::LocalWeb => "local-web",
        Tier::Sharing => "sharing",
    }
}

/// The tier with this file name. The match is exact and case-sensitive; any other name gives `None`.
pub fn tier_from_name(name: &str) -> Option<Tier> {
    match name {
        "local" => Some(Tier::Local),
        "local-web" => Some(Tier::LocalWeb),
        "sharing" => Some(Tier::Sharing),
        _ => None,
    }
}
