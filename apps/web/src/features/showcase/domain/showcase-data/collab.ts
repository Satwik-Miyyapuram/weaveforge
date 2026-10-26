/**
 * Supervision and sharing: what a supervisor says on the student's plan and
 * logbook, and how the student answers. Targets are milestone titles or
 * logbook `daysAgo` values from `plan.ts`.
 */

export interface ShowcaseCommentThread {
  resource: "milestone" | "log_entry";
  /** Milestone title, or the log entry's `daysAgo`. */
  target: string | number;
  /** The supervisor's opening comment. */
  body: string;
  /** The student's replies, in order. */
  replies: string[];
  /** Closed by the student after the replies. */
  resolved?: boolean;
}

export const SHOWCASE_SUPERVISOR_COMMENTS: ShowcaseCommentThread[] = [
  {
    resource: "milestone",
    target: "Graph-prior module v1",
    body: "Before calling this done I'd like to see the variance across the three seeds, not just the best one.",
    replies: ["Error bands added to the exp-03 chart; seed 13 is the weakest at MIG 0.26."],
  },
  {
    resource: "milestone",
    target: "Ablation study",
    body: "What happens to this if the cluster renewal is late? Is there a reduced version?",
    replies: ["Yes: depth {1, 3} × sum/mean only, one seed. Fits in the remaining allocation."],
  },
  {
    resource: "milestone",
    target: "Ethics approval (user study)",
    body: "If ethics is not through by the end of the month, drop §5 and keep it for the journal version.",
    replies: [],
  },
  {
    resource: "milestone",
    target: "Literature review draft",
    body: "Ch. 2 still leans on GANs. Cut that section by half and add the graph-prior papers.",
    replies: ["Done in the revision: GAN section is now one paragraph, graph priors have their own subsection."],
    resolved: true,
  },
  {
    resource: "log_entry",
    target: 0,
    body: "Good result. Keep the seed 7 checkpoint, we will want it for the traversal figure.",
    replies: ["Saved it to the run's artifacts and tagged it `traversal-fig`."],
  },
  {
    resource: "log_entry",
    target: 3,
    body: "Chase the ethics office again on Monday and copy me in.",
    replies: [],
  },
];
