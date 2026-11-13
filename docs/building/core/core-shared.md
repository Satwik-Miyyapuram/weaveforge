# Shared core modules

Small pure modules at the top of `crates/wf-core/src/` that several features use. They hold no I/O; wasm exports live in `crates/wf-wasm/src`; TS keeps the I/O.

| Module | Rust fn | wasm export | TS caller |
| --- | --- | --- | --- |
| `collab` | `peers_from_states`, `same_peers`, `should_persist_body` | `peersFromStates`, `samePeers`, `shouldPersistBody` | `apps/web/src/features/collab/ui/collaborative-markdown-editor.tsx`, `apps/web/src/features/collab/application/parts.ts` |
| `experiments` | `stride_for_step`, `is_on_sampling_grid`, `plan_series_ingest`, `steps_to_prune` | `strideForStep`, `isOnSamplingGrid`, `planSeriesIngest`, `stepsToPrune` | — (test files only) |
| `mcp` | `tool_manifest`, `is_uuid`, `valid_envelope`, `exceeds_declared_limit`, `relay_ttl_ms` | native only | — |
| `member` | `role_rank`, `can_create_role`, `validate_new_member`, `mask_email`, `parse_otp_or_link`, `creatable_roles`, `filter_team_members`, `filter_lab_members`, `students_of`, `is_supervisor_role`, `resolve_display_role`, `needs_standalone_role_sync`, `resolve_supervisor_id`, `member_name_map`, `accessible_member_ids`, `role_label`, `member_role_label` | `roleRank`, `canCreateRole`, `validateNewMember`, `creatableRoles`, `filterTeamMembers`, `filterLabMembers`, `studentsOf`, `isSupervisorRole`, `resolveDisplayRole`, `needsStandaloneRoleSync`, `resolveSupervisorId`, `memberNameMap`, `memberRoleLabel`, `memberRoleLabelOf` (`mask_email`, `parse_otp_or_link`, `accessible_member_ids`, `role_label` native only) | `apps/web/src/container/facades/org.ts`, `apps/web/src/features/org/ui/org-screen.tsx`, `apps/web/src/features/org/ui/member-tree.tsx`, `apps/web/src/features/org/infrastructure/postgrest-member-repository.ts`, `apps/web/src/features/org/ui/supervision-screen.tsx`, `apps/web/src/features/dashboard/ui/dashboard-screen.tsx`, `apps/web/src/features/settings/ui/account-info-panel.tsx`, `apps/web/src/features/sharing/ui/shared-with-me-screen.tsx`, `apps/web/src/features/sharing/ui/note-comments.tsx`, `apps/web/src/features/sharing/application/parts.ts` |
| `tree` | `build_tree` | native only | — |
| `units` | `ByteLen`, `DurationMs` | native only | — |
| `zotero` | `normalize_library` | native only | — |

Rules:

- `collab`: skips the viewer's own client and own author id, and dedups peers by author id. A peer with no id is keyed `client:<n>`; name defaults to `Someone`, colour to `var(--accent)`.
- `collab`: `should_persist_body` saves only when ready and the body differs from the last saved body.
- `experiments`: stride is 1 up to `KEEP_ALL_BELOW_STEP` (10,000), then doubles per octave. Non-test TS does not call the wasm names; they are used by `apps/web/src/features/experiments/test/downsample-metrics.test.ts`.
- `mcp`: `MAX_ENVELOPE_CHARS` (64,000) and `MAX_BODY_BYTES` (68,096) bound relayed envelopes; `relay_ttl_ms` defaults to 90,000 ms and clamps to 15,000–600,000 ms.
- `member`: module doc is "Lab member rules: role ranks, new-member validation, email masking, and confirmation-code parsing." `mask_email`, `parse_otp_or_link`, `accessible_member_ids` and `role_label` have no wasm export, so TS cannot call them.
- `tree`: `build_tree` ports `buildTree` in `packages/core/src/shared/parts.ts`. A missing or empty parent makes a root; a later duplicate id replaces the earlier one in place; a parent loop is cut at one node that becomes a root; each level is stably sorted by `compare`.
- `units`: `ByteLen(u64)` and `DurationMs(u64)` have no serde or specta derive. `From<Duration> for DurationMs` rounds down and saturates at `u64::MAX`.
- `zotero`: `normalize_library` trims the input, turns bare digits into `users/<id>`, keeps `users/<digits>` and `groups/<digits>`, and returns `None` for anything else.

Source: `crates/wf-core/src/` (`collab.rs`, `experiments.rs`, `mcp.rs`, `member.rs`, `tree.rs`, `units.rs`, `zotero.rs`)
