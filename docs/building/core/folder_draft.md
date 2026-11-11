# Folder draft core module

The folder-draft rules (`ai::folder_draft`) decide which files in the MCP drafts folder
are drafts and which belong to the open project. The import loop stays in TypeScript.

## What lives in Rust

- `is_folder_draft_path`: a draft is any file name ending in `.json`.
- `folder_draft_for_project`: parses the draft, and returns it only when it has no project
  or its project matches the open one. An empty project id counts as no project.

Source: `crates/wf-core/src/ai/folder_draft.rs`. Wasm: `crates/wf-wasm/src/ai_folder_import.rs`
(`isFolderDraftPath`, `folderDraftForProject`). Wrapper: `packages/wf-wasm/src/wrappers-1.ts`.

## What stays in TypeScript

`apps/web/src/features/ai-assistant/application/import-folder-drafts.ts` keeps the folder
listing, the delete and write-back, the queue calls, and the single-flight run.
