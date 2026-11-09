# The AI assistant

The assistant answers questions and drafts changes, but it only sees what you
allow, only for as long as you allow it, and it never writes to your workspace
without your approval.

## How to

1. Turn AI on in Settings and accept the disclosure. Until both are done, the
   assistant refuses every request.
2. Pick the read categories it may use: paper metadata, paper notes, Zotero
   annotations, reading lists, vault notes, the logbook and experiments.
3. Pick the proposal kinds it may suggest, such as a new log entry or a paper
   note. A suggestion is a draft that waits for you to approve it.
4. Start a session. A session grant names the resources, tools and proposal
   kinds it covers, and it has an expiry date. When the grant expires, the
   assistant stops until you start a new one.

To ask a question of your library, the search answers from the passages it
finds and cites each one as [1], [2] and so on. Those passages are your
documents, so the model is told to treat them as data, not instructions.

## Reference

Read categories: paper metadata, paper notes, Zotero annotations, reading
lists, vault notes, logbook, experiments.

Proposal kinds include: append a paper note, create a vault note, create a log
entry, update a paper, set a paper field, change a reading list, add a relation,
import from Zotero, follow up on a milestone or an experiment, edit or append to
a vault note, edit a report, change a milestone status, update an experiment,
and annotate a paper.

Tools the assistant can call: search the workspace, read a source excerpt, read
the outline, and make suggestions. The suggest tools cover the append paper note,
vault note, log entry, paper update, paper field, reading list, relation, Zotero
import, milestone and experiment follow-up proposals. The other kinds (edit or
append a vault note, report edit, milestone status, experiment update, paper
annotation) are not offered as tools.

A request is refused with one of these reasons:

- AI is off.
- The disclosure was never accepted.
- The encryption key is locked.
- The session grant is expired, or its date does not parse.
- The resource is not in the grant.
- The read category is turned off.
- The tool is not in the grant.
- The proposal kind is not allowed.
- The proposal needs credential protection. No current kind does.

Each resource type maps to one read category. A resource with no id cannot be
checked against a grant, so it is refused.

Tool results are capped: each item at 8,000 characters, and the whole result at
32,000 characters. A capped result carries a notice saying it was cut.

## How it works

The access rules, the untrusted-context fencing and the tool-result caps are
pure functions in Rust. The web app calls them through the WebAssembly build.
The assistant sidecar still runs its own copy of the tool-name and result
helpers, and the lexical concept extractor and wiki linting still run in
TypeScript. The policy is checked before any model call, so a denied request
never reaches the model.

Source: `crates/wf-core/src/ai/`

## Related

- [Search](search.md) — how the passages for a question are found
- [Integrations](integrations.md) — the MCP server the assistant's tools come through
- [Getting started](getting-started.md) — where AI is switched on