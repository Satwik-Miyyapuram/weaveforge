/**
 * Generic data-access contracts.
 *
 * Split into read and write halves so consumers depend only on what they need
 * (Interface Segregation Principle). A read-only view (e.g. a graph render)
 * depends on `IReadableRepository`; it never gains write power it shouldn't have.
 *
 * These interfaces live in the domain layer. Concrete persistence
 * (Supabase, in-memory, SQLite) implements them in the infrastructure layer.
 * Nothing here knows how data is stored (Dependency Inversion Principle).
 */

/** An entity that can be persisted by id. */
export interface Identifiable {
  readonly id: string;
}

export interface IReadableRepository<T extends Identifiable, F = unknown> {
  getById(id: string): Promise<T | null>;
  list(filter?: F): Promise<T[]>;
}

export interface IWritableRepository<T extends Identifiable> {
  save(entity: T): Promise<void>;
  delete(id: string): Promise<void>;
}
