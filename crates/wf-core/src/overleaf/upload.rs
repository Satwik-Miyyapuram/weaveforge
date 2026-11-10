//! Root folder id from Overleaf's join answer (port of `rootFolderIdOf` in
//! apps/web/src/features/overleaf/infrastructure/overleaf-upload.ts).

use serde_json::Value;

/// The project's root folder id from the join answer, or `None` when the project is read-only or the
/// answer has none. The first argument with a string root folder id decides: a `readOnly`
/// permission on that argument returns `None` at once.
#[must_use]
pub fn root_folder_id_of(join: &[Value]) -> Option<String> {
    for arg in join {
        let Value::Object(obj) = arg else { continue };
        let id = obj
            .get("project")
            .and_then(|p| p.get("rootFolder"))
            .and_then(|folders| folders.get(0))
            .and_then(|folder| folder.get("_id"));
        let Some(Value::String(id)) = id else {
            continue;
        };
        let read_only = obj.get("permissionsLevel") == Some(&Value::String("readOnly".to_owned()));
        return if read_only { None } else { Some(id.clone()) };
    }
    None
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::root_folder_id_of;

    #[test]
    fn reads_root_folder_for_writable_project() {
        let join = [
            json!({ "project": { "rootFolder": [{ "_id": "r1" }] }, "permissionsLevel": "owner" }),
        ];
        assert_eq!(root_folder_id_of(&join).as_deref(), Some("r1"));
    }

    #[test]
    fn skips_arguments_without_a_root_folder() {
        let join = [
            json!(null),
            json!({ "project": { "rootFolder": [{ "_id": "r2" }] } }),
        ];
        assert_eq!(root_folder_id_of(&join).as_deref(), Some("r2"));
    }

    #[test]
    fn read_only_project_has_no_root_folder() {
        let join = [
            json!({ "project": { "rootFolder": [{ "_id": "r1" }] }, "permissionsLevel": "readOnly" }),
        ];
        assert_eq!(root_folder_id_of(&join), None);
    }

    #[test]
    fn missing_or_non_string_id_yields_none() {
        assert_eq!(root_folder_id_of(&[json!({ "project": {} })]), None);
        assert_eq!(
            root_folder_id_of(&[json!({ "project": { "rootFolder": [{ "_id": 7 }] } })]),
            None
        );
        assert_eq!(root_folder_id_of(&[]), None);
    }
}
