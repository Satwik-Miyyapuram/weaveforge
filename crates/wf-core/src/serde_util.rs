//! Small serde helpers shared by the ported input types.

use serde::{Deserialize, Deserializer};

/// `null` (and a JS `undefined` key) reads as the default, as the TypeScript's `?? ""` / `?? []` do.
pub(crate) fn null_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: Default + Deserialize<'de>,
{
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Deserialize)]
    struct Row {
        #[serde(default, deserialize_with = "null_default")]
        items: Vec<u8>,
    }

    #[test]
    fn null_and_missing_read_as_default() {
        let a: Row = serde_json::from_str(r#"{"items":null}"#).unwrap();
        let b: Row = serde_json::from_str("{}").unwrap();
        let c: Row = serde_json::from_str(r#"{"items":[1]}"#).unwrap();
        assert!(a.items.is_empty() && b.items.is_empty());
        assert_eq!(c.items, vec![1]);
    }
}
