import { repoTail, WIRE } from "./tail.mjs";

const tail = (n, by, table, cacheSym, method, sym) =>
  repoTail(n, by, { cache: { fn: "cacheRepo", path: WIRE, sym: cacheSym }, table, method, sym });

export default {
  id: "lab", name: "Lab", blurb: "Experiments, the logbook and the plan.",
  intro: "Plan the work, run experiments, and write down what happened.",
  stages: [
    { name: "Plan", journeys: ["milestone"] },
    { name: "Run", journeys: ["new-experiment"] },
    { name: "Record", journeys: ["log-entry"] },
  ],
  journeys: [
    {
      id: "new-experiment", name: "Create an experiment",
      blurb: "Add an experiment by hand from the Experiments screen.",
      outcome: "The new experiment is in your Experiments list.",
      help: { path: "docs/using/experiments.md", heading: "Create an experiment by hand" },
      steps: [
        { title: "Open the form", text: "Click **New experiment**.", ui: "New experiment", hops: [1] },
        { title: "Save it", text: "Fill in the form and click **Create**.", ui: "Create", hops: [2, 3, 4, 5, 6, 7, 8, 9] },
      ],
      chain: [
        { n: 1, layer: "ui", fn: "ExperimentsScreen New experiment", path: "apps/web/src/features/experiments/ui/experiments-screen.tsx", sym: "onClick={() => setComposeOpen(true)}>", line: 180 },
        { n: 2, by: 1, layer: "ui", fn: "AddExperimentForm submit", path: "apps/web/src/features/experiments/ui/add-experiment-form.tsx", sym: "getContainer().experiments.manageExperiment.add({" },
        { n: 3, by: 2, layer: "service", fn: "ExperimentsFacade.manageExperiment", path: "apps/web/src/container/facades/experiments.ts", sym: "get manageExperiment() {" },
        ...tail(4, 3, "experiments", "const experimentRepository = cacheRepo(", "add", "fn add(call: &RepoCall) -> RepoStep {"),
      ],
      debug: [
        { see: "Create shows an error about Config JSON or a validation message", check: 2 },
        { see: "Experiment saved but not listed", check: 4 },
      ],
    },
    {
      id: "log-entry", name: "Add a logbook entry",
      blurb: "Write down what you did today.",
      outcome: "The new entry is at the top of your Logbook.",
      help: { path: "docs/using/logbook.md", heading: "Add an entry" },
      steps: [
        { title: "Open the form", text: "Click **New entry**.", ui: "New entry", hops: [1] },
        { title: "Save it", text: "Type the entry and click **Create**.", ui: "Create", hops: [2, 3, 4, 5, 6, 7, 8, 9] },
      ],
      chain: [
        { n: 1, layer: "ui", fn: "LogbookScreen New entry", path: "apps/web/src/features/logbook/ui/logbook-screen.tsx", sym: "onClick={() => setAddOpen(true)}>New entry</Button>" },
        { n: 2, by: 1, layer: "ui", fn: "AddLogEntryForm submit", path: "apps/web/src/features/logbook/ui/add-log-entry-form.tsx", sym: "logbook.addLogEntry.add({ body, kind })" },
        { n: 3, by: 2, layer: "service", fn: "LogbookFacade.addLogEntry", path: "apps/web/src/container/facades/logbook.ts", sym: "get addLogEntry() {" },
        ...tail(4, 3, "log_entries", "const logEntryRepository = cacheRepo(", "add", "fn add(call: &RepoCall) -> RepoStep {"),
      ],
      debug: [
        { see: "Entry saved but the Git push or chat post is missing (best effort, silent)", check: 2 },
        { see: "Create fails with a validation error", check: 8 },
      ],
    },
    {
      id: "milestone", name: "Mark a milestone done",
      blurb: "Tick a milestone's checkbox in the Plan.",
      outcome: "The milestone shows as done.",
      help: { path: "docs/using/plan.md", heading: "Change a milestone's status" },
      steps: [
        { title: "Tick it", text: "Tick the checkbox next to the milestone.", ui: { verb: "Tick", label: "Mark … done" }, hops: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
      ],
      chain: [
        { n: 1, layer: "ui", fn: "MilestoneCard checkbox", path: "apps/web/src/features/plan/ui/milestone-card.tsx", sym: "void setStatus(e.target.checked ? \"done\" : \"planned\")" },
        { n: 2, by: 1, layer: "ui", fn: "MilestoneCard.setStatus", path: "apps/web/src/features/plan/ui/milestone-card.tsx", sym: "async function setStatus(status: MilestoneStatus) {" },
        { n: 3, by: 2, layer: "service", fn: "PlanFacade.manageMilestone", path: "apps/web/src/container/facades/index.ts", sym: "get manageMilestone() {" },
        ...tail(4, 3, "milestones", "const milestoneRepository = cacheRepo(", "set_status", "fn set_status(call: &RepoCall) -> RepoStep {"),
        { n: 10, by: 8, layer: "core", fn: "milestones::mutate → save", path: "crates/wf-core/src/repos/milestones.rs", sym: "fn mutate(call: &RepoCall, id: &str" },
      ],
      debug: [
        { see: "Tick jumps back, nothing changes", check: 5 },
        { see: "Tick works but the notification is not sent", check: 2 },
      ],
    },
  ],
};
