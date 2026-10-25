import { z } from 'zod';

/** Shared zod pieces used by both the doctors and patients list contracts. */

export const objectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Must be a 24-character hex id');

export const idParamSchema = z.object({ id: objectIdSchema });

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function assertParsable(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

export const fromDateSchema = z
  .string()
  .refine(assertParsable, 'Must be an ISO date')
  .transform((value) => new Date(value));

/**
 * `to` is an *inclusive* upper bound. A date input sends `2026-08-13`, which parses to
 * midnight — filtering `createdAt <= midnight` would silently drop everything created
 * during the day the user just asked for. Date-only values are therefore widened to the
 * end of that day; values that carry a time are respected as given.
 */
export const toDateSchema = z
  .string()
  .refine(assertParsable, 'Must be an ISO date')
  .transform((value) => (DATE_ONLY.test(value) ? new Date(`${value}T23:59:59.999Z`) : new Date(value)));

export function buildDateRange(
  from?: Date,
  to?: Date,
): { $gte?: Date; $lte?: Date } | undefined {
  if (!from && !to) return undefined;
  const range: { $gte?: Date; $lte?: Date } = {};
  if (from) range.$gte = from;
  if (to) range.$lte = to;
  return range;
}
