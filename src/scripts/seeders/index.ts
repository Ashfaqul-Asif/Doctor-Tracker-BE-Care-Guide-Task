import { adminSeeder } from './adminSeeder.js';
import { doctorSeeder } from './doctorSeeder.js';
import { patientSeeder } from './patientSeeder.js';
import type { Seeder } from './shared.js';

/**
 * Order matters: patients reference doctors (FR-16), so the roster is seeded first.
 */
export const seeders: readonly Seeder[] = [adminSeeder, doctorSeeder, patientSeeder];

export function seederNames(): string[] {
  return seeders.map((seeder) => seeder.name);
}

export function selectSeeders(only: string[] | null): Seeder[] {
  if (!only) return [...seeders];

  const unknown = only.filter((name) => !seederNames().includes(name));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown seeder(s): ${unknown.join(', ')}. Available: ${seederNames().join(', ')}`,
    );
  }

  // Filtering the canonical list rather than mapping the input preserves dependency
  // order regardless of the order the flags were typed in.
  return seeders.filter((seeder) => only.includes(seeder.name));
}

export type { Seeder, SeedContext } from './shared.js';
