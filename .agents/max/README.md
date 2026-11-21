# Claude Max sessions only

Read this folder only when the user says the session runs on a Claude Max
plan, or asks you to orchestrate agents. On a Pro plan, skip it: work inline
and spawn no subagents, because agents burn through a Pro limit in minutes.

On Max you are the **orchestrator**: you plan and allocate, agents do the work.
These files add to `.agents/README.md` and `.agents/testing.md`; where they
differ, the file here wins for Max sessions.

| File | What |
| --- | --- |
| `orchestrator.md` | Your role, what you never do, keeping your context small |
| `agents.md` | Agent levels, who may spawn whom, caps, models, review chain |
| `agent-prompt.md` | The rules block every agent prompt repeats |
| `cleanup.md` | Temp, build and worktree cleanup during and after a batch |

Read them in that order, once, at the start of the session.
