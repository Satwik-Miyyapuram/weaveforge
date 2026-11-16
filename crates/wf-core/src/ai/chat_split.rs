//! Pure rule for splitting a chat into its system prompt and the other messages (TS `splitSystem`
//! in `byok-model-conversation.ts`). Messages stay raw JSON so extra fields reach the provider.

use serde_json::Value;

/// Separator placed between the text of system messages (TS `"\n\n"`).
const SYSTEM_SEPARATOR: &str = "\n\n";

/// A chat split into the joined system prompt and the other messages (TS `{ system, rest }`).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct SplitSystem {
    /// Every system message's text, in order, joined by a blank line.
    pub system: String,
    /// The messages that are not system messages, unchanged and in their original order.
    pub rest: Vec<Value>,
}

/// Splits `messages` into the joined system prompt and the rest. A message is a system message
/// when its `role` is the string `"system"`. Its text is its `content` when that is a string,
/// nothing when `content` is missing or `null` (JS `join` renders it as an empty string), and
/// the JSON text of any other value.
pub fn split_system(messages: &[Value]) -> SplitSystem {
    let mut texts: Vec<String> = Vec::new();
    let mut rest: Vec<Value> = Vec::new();
    for message in messages {
        if message.get("role").and_then(Value::as_str) == Some("system") {
            texts.push(system_text(message.get("content")));
        } else {
            rest.push(message.clone());
        }
    }
    SplitSystem {
        system: texts.join(SYSTEM_SEPARATOR),
        rest,
    }
}

/// The text one system message contributes to the joined prompt.
fn system_text(content: Option<&Value>) -> String {
    match content {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(text)) => text.clone(),
        Some(other) => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::split_system;

    #[test]
    fn joins_system_messages_in_order_and_keeps_the_rest() {
        let messages = [
            json!({ "role": "system", "content": "Be brief." }),
            json!({ "role": "user", "content": "Hi" }),
            json!({ "role": "system", "content": "Cite sources." }),
            json!({ "role": "assistant", "content": "Hello" }),
        ];
        let split = split_system(&messages);
        assert_eq!(split.system, "Be brief.\n\nCite sources.");
        assert_eq!(
            split.rest,
            vec![
                json!({ "role": "user", "content": "Hi" }),
                json!({ "role": "assistant", "content": "Hello" }),
            ]
        );
    }

    #[test]
    fn no_system_message_gives_empty_system() {
        let messages = [json!({ "role": "user", "content": "Hi" })];
        let split = split_system(&messages);
        assert_eq!(split.system, "");
        assert_eq!(split.rest, messages.to_vec());
    }

    #[test]
    fn keeps_extra_fields_on_rest_messages() {
        let message = json!({ "role": "user", "content": "Hi", "name": "ada", "extra": 3 });
        let split = split_system(std::slice::from_ref(&message));
        assert_eq!(split.rest, vec![message]);
    }

    #[test]
    fn null_or_missing_system_content_adds_an_empty_part() {
        let messages = [
            json!({ "role": "system", "content": "a" }),
            json!({ "role": "system", "content": null }),
            json!({ "role": "system" }),
            json!({ "role": "system", "content": "b" }),
        ];
        let split = split_system(&messages);
        assert_eq!(split.system, "a\n\n\n\n\n\nb");
        assert!(split.rest.is_empty());
    }

    #[test]
    fn non_string_system_content_uses_its_json_text() {
        let messages = [json!({ "role": "system", "content": 42 })];
        assert_eq!(split_system(&messages).system, "42");
    }

    #[test]
    fn role_must_be_exactly_system() {
        let messages = [
            json!({ "role": "System", "content": "x" }),
            json!({ "content": "no role" }),
        ];
        let split = split_system(&messages);
        assert_eq!(split.system, "");
        assert_eq!(split.rest.len(), 2);
    }
}
