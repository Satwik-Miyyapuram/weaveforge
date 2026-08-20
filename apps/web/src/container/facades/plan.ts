import type { INotificationIntegration, ManageMilestoneUseCase, Milestone } from "@weaveforge/core";
import type { LoadPlanScreenUseCase, PlanScreenData as PlanScreenLoadData } from "@/features/plan/application/load-plan-screen.use-case";

export type PlanScreenData = PlanScreenLoadData;

export class PlanFacade {
  constructor(
    private readonly deps: {
      load: LoadPlanScreenUseCase;
      milestones: import("@weaveforge/core").IMilestoneRepository;
      manageMilestone: ManageMilestoneUseCase;
      notifications: INotificationIntegration;
    },
  ) {}

  loadScreenData(): Promise<PlanScreenData> {
    return this.deps.load.execute();
  }

  getMilestone(id: string) {
    return this.deps.milestones.getById(id);
  }

  notifyMilestone(event: "added" | "status", milestone: Milestone) {
    return this.deps.notifications.notifyMilestone(event, milestone);
  }

  get manageMilestone() {
    return this.deps.manageMilestone;
  }
}
