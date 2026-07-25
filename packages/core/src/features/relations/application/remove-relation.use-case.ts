import type { IPaperRelationRepository } from "../domain/paper-relation-repository.js";

export class RemoveRelationUseCase {
  constructor(private readonly repository: IPaperRelationRepository) {}

  async execute(relationId: string): Promise<void> {
    await this.repository.delete(relationId);
  }
}
