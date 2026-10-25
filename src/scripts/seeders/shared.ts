import type { Types } from 'mongoose';

/** Documents inserted per `insertMany` call, to keep any single BSON payload sane. */
export const BATCH_SIZE = 1_000;

const HISTORY_MONTHS = 12;

export interface SeedContext {
  /**
   * Doctor ids available to dependent seeders. Populated by the doctors seeder; when
   * only the patients seeder runs, it resolves these from the database instead.
   */
  doctorIds: Types.ObjectId[];
}

export interface Seeder {
  name: string;
  description: string;
  run(context: SeedContext): Promise<void>;
}

export function pick<T>(items: readonly T[]): T {
  // `items` is never empty at any call site; the assertion keeps
  // noUncheckedIndexedAccess from leaking `undefined` into every caller.
  return items[Math.floor(Math.random() * items.length)]!;
}

/** A date somewhere in the last year, so the registrations chart has a shape. */
export function randomCreatedAt(): Date {
  const now = Date.now();
  const earliest = now - HISTORY_MONTHS * 30 * 24 * 60 * 60 * 1000;
  return new Date(earliest + Math.random() * (now - earliest));
}

/**
 * Squaring a uniform random biases selection toward the front of the list, so a handful
 * of doctors end up with far more patients than the rest. A flat distribution would make
 * the "top doctors" chart a straight line and hide any bug in its ordering.
 */
export function skewedIndex(length: number): number {
  return Math.min(Math.floor(Math.random() ** 2 * length), length - 1);
}
