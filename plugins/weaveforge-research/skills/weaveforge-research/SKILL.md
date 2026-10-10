---
name: weaveforge-research
description: Work with the researcher's WeaveForge workspace through its local MCP tools - read and search notes, papers, experiments, the plan and the logbook, leave drafts for them to approve, and set up experiment tracking with the weaveforge Python SDK.
---

# WeaveForge research workflow

Use this when the user asks about their research in WeaveForge: notes, papers,
reading lists, experiments, milestones, the logbook or the report, or when you
write training or analysis code for one of their projects.

## How access works

WeaveForge runs an MCP server on this computer only (`127.0.0.1`). Nothing goes
through a WeaveForge server. The tools work only while the WeaveForge app is
open and the user has pressed **Connect** in **Settings → AI & MCP**. If the
tools are missing or answer that the app is closed, say so and ask the user to
open WeaveForge and connect. Never guess at content you could not read.

## Reading

- Start broad with `search_workspace` or `list_workspace`, then open single
  entries with `get_note`, `get_paper`, `get_experiment`, `get_milestone`,
  `get_log`, `get_reading_list` or `get_report_section`.
- `get_paper_text` returns a paper's PDF text a few pages at a time. Cite the
  page you quote. It needs the paper opened once in WeaveForge.
- `get_relations` and `list_tags` show how papers and notes connect.
- Quote and cite what you read; mark your own inference as inference.

## Writing: drafts only

Every `suggest_*` tool leaves a draft. Nothing in the workspace changes until
the user approves it in WeaveForge. Give each draft a short, honest
`rationale`; the user reads it when approving.

- Notes: `suggest_note_create`, `suggest_note_edit`, `suggest_note_append`.
- Plan and logbook: `suggest_milestone`, `suggest_milestone_status`,
  `suggest_log_entry`.
- Papers: `suggest_paper_update`, `suggest_paper_note`, `suggest_annotation`,
  `suggest_relation`, `suggest_reading_list_change`.
- Experiments and report: `suggest_experiment`, `suggest_experiment_update`,
  `suggest_report_edit`.

Prefer one focused draft per change over one large rewrite. Tell the user what
you drafted and that it waits for their approval.

## Experiment tracking in code

When you write training, evaluation or analysis code for one of the user's
projects, call `experiment_tracking_setup` first. It returns the install line,
where the token lives, the API URL, the project names and a working example
for the `weaveforge` Python SDK. In short:

```bash
pip install weaveforge            # extras: [figures] [tensorboard] [wandb] [lightning] [keras] [all]
```

```python
from weaveforge import track

with track("baseline-lr3e-4", project="<project>", config={"lr": 3e-4}) as run:
    for epoch in range(epochs):
        run.log_metrics({"loss": loss, "acc": acc}, step=epoch)
    run.log_summary({"best_acc": best})
```

- The SDK reads the token from the file `experiment_tracking_setup` names.
  Never copy the token into code, notebooks, commits or chat.
- Set the project with `project=` or the `WEAVEFORGE_PROJECT` environment
  variable.
- Runs logged this way show up in the project's experiments in WeaveForge.
