import type { TimeInterval } from '../modules/dashboard/dashboard.schema.js';

/**
 * Bucket arithmetic for the registrations time series, done in UTC to match
 * `$dateTrunc`'s default timezone — mixing the two would shift every point by the
 * server's offset.
 */

export function truncateToInterval(date: Date, interval: TimeInterval): Date {
  const value = new Date(date.getTime());

  if (interval === 'month') {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
  }

  const startOfDay = new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );

  if (interval === 'week') {
    // Monday-based, matching `startOfWeek: 'monday'` in the aggregation.
    const dayOfWeek = startOfDay.getUTCDay();
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    startOfDay.setUTCDate(startOfDay.getUTCDate() - daysSinceMonday);
  }

  return startOfDay;
}

export function addInterval(date: Date, interval: TimeInterval): Date {
  const next = new Date(date.getTime());
  if (interval === 'day') next.setUTCDate(next.getUTCDate() + 1);
  else if (interval === 'week') next.setUTCDate(next.getUTCDate() + 7);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

/**
 * `$group` only emits buckets that contain documents. A chart drawn straight from that
 * silently closes the gaps, so a week with no registrations looks like a flat line
 * between its neighbours instead of a drop to zero.
 */
export function fillGaps(
  counts: Map<number, number>,
  from: Date,
  to: Date,
  interval: TimeInterval,
): Array<{ date: string; count: number }> {
  const points: Array<{ date: string; count: number }> = [];
  let cursor = truncateToInterval(from, interval);
  const end = truncateToInterval(to, interval);

  // Guard against a pathological range producing an unbounded array.
  const MAX_POINTS = 800;

  while (cursor.getTime() <= end.getTime() && points.length < MAX_POINTS) {
    points.push({ date: cursor.toISOString(), count: counts.get(cursor.getTime()) ?? 0 });
    cursor = addInterval(cursor, interval);
  }

  return points;
}

/** Sensible default windows when the caller doesn't specify a range. */
export function defaultRange(interval: TimeInterval): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date(to.getTime());

  if (interval === 'day') from.setUTCDate(from.getUTCDate() - 29);
  else if (interval === 'week') from.setUTCDate(from.getUTCDate() - 7 * 11);
  else from.setUTCMonth(from.getUTCMonth() - 11);

  return { from: truncateToInterval(from, interval), to };
}
