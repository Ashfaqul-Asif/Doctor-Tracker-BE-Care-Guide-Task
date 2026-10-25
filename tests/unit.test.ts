import { describe, expect, it } from 'vitest';
import { cache } from '../src/lib/cache.js';
import { escapeRegex } from '../src/lib/escapeRegex.js';
import { nameTokenFilter, tokenizeName } from '../src/lib/nameSearch.js';
import { paginate, paginationQuerySchema, toSkip } from '../src/lib/pagination.js';
import { buildDateRange, fromDateSchema, toDateSchema } from '../src/lib/queryPrimitives.js';
import { addInterval, defaultRange, fillGaps, truncateToInterval } from '../src/lib/timeBuckets.js';
import { buildDoctorFilter } from '../src/modules/doctors/doctors.service.js';
import { buildPatientFilter } from '../src/modules/patients/patients.service.js';

/**
 * The pure logic behind the query layer — bucket arithmetic, date-range widening and
 * filter construction — tested without a database, since these are where an off-by-one
 * hides most comfortably.
 */

describe('escapeRegex', () => {
  it('neutralises regex metacharacters', () => {
    expect(escapeRegex('a.*b')).toBe('a\\.\\*b');
    expect(escapeRegex('(x)[y]')).toBe('\\(x\\)\\[y\\]');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeRegex('alice')).toBe('alice');
  });
});

describe('pagination', () => {
  it('computes skip from page and limit', () => {
    expect(toSkip(1, 20)).toBe(0);
    expect(toSkip(3, 10)).toBe(20);
  });

  it('reports zero pages for an empty result rather than one empty page', () => {
    expect(paginate([], { page: 1, limit: 20, total: 0 })).toMatchObject({
      total: 0,
      totalPages: 0,
    });
  });

  it('rounds partial pages up', () => {
    expect(paginate([], { page: 1, limit: 20, total: 21 }).totalPages).toBe(2);
    expect(paginate([], { page: 1, limit: 20, total: 40 }).totalPages).toBe(2);
  });

  it('defaults and clamps the page size', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(paginationQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ page: 0 }).success).toBe(false);
  });
});

describe('date range parsing', () => {
  it('widens a date-only `to` to the end of that day', () => {
    const parsed = toDateSchema.parse('2026-01-31');
    expect(parsed.toISOString()).toBe('2026-01-31T23:59:59.999Z');
  });

  it('respects a `to` that carries a time', () => {
    const parsed = toDateSchema.parse('2026-01-31T10:00:00.000Z');
    expect(parsed.toISOString()).toBe('2026-01-31T10:00:00.000Z');
  });

  it('leaves `from` at the start of the day', () => {
    expect(fromDateSchema.parse('2026-01-31').toISOString()).toBe('2026-01-31T00:00:00.000Z');
  });

  it('rejects nonsense', () => {
    expect(toDateSchema.safeParse('not-a-date').success).toBe(false);
  });

  it('builds a mongo range only when a bound is present', () => {
    expect(buildDateRange(undefined, undefined)).toBeUndefined();
    expect(buildDateRange(new Date('2026-01-01'), undefined)).toEqual({
      $gte: new Date('2026-01-01'),
    });
  });
});

describe('time buckets', () => {
  it('truncates to the start of the UTC day', () => {
    expect(truncateToInterval(new Date('2026-03-03T18:45:00.000Z'), 'day').toISOString()).toBe(
      '2026-03-03T00:00:00.000Z',
    );
  });

  it('truncates weeks to the preceding Monday', () => {
    // 2026-03-05 is a Thursday.
    expect(truncateToInterval(new Date('2026-03-05T12:00:00.000Z'), 'week').toISOString()).toBe(
      '2026-03-02T00:00:00.000Z',
    );
    // A Sunday belongs to the week that started six days earlier, not the next one.
    expect(truncateToInterval(new Date('2026-03-08T12:00:00.000Z'), 'week').toISOString()).toBe(
      '2026-03-02T00:00:00.000Z',
    );
  });

  it('truncates months to the first', () => {
    expect(truncateToInterval(new Date('2026-03-31T23:00:00.000Z'), 'month').toISOString()).toBe(
      '2026-03-01T00:00:00.000Z',
    );
  });

  it('advances across month and year boundaries', () => {
    expect(addInterval(new Date('2026-01-31T00:00:00.000Z'), 'day').toISOString()).toBe(
      '2026-02-01T00:00:00.000Z',
    );
    expect(addInterval(new Date('2026-12-01T00:00:00.000Z'), 'month').toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
    expect(addInterval(new Date('2026-03-02T00:00:00.000Z'), 'week').toISOString()).toBe(
      '2026-03-09T00:00:00.000Z',
    );
  });

  it('fills empty buckets with zero instead of closing the gap', () => {
    const counts = new Map<number, number>([
      [Date.UTC(2026, 2, 1), 1],
      [Date.UTC(2026, 2, 3), 2],
    ]);

    const points = fillGaps(
      counts,
      new Date('2026-03-01T00:00:00.000Z'),
      new Date('2026-03-03T23:59:59.999Z'),
      'day',
    );

    expect(points.map((p) => p.count)).toEqual([1, 0, 2]);
    expect(points[0]?.date).toBe('2026-03-01T00:00:00.000Z');
  });

  it('produces a single point when the range is one bucket wide', () => {
    const points = fillGaps(
      new Map(),
      new Date('2026-03-01T01:00:00.000Z'),
      new Date('2026-03-01T22:00:00.000Z'),
      'day',
    );
    expect(points).toHaveLength(1);
  });

  it('caps a pathological range instead of allocating forever', () => {
    const points = fillGaps(
      new Map(),
      new Date('1900-01-01T00:00:00.000Z'),
      new Date('2100-01-01T00:00:00.000Z'),
      'day',
    );
    expect(points).toHaveLength(800);
  });

  it('offers sensible default windows', () => {
    expect(defaultRange('day').from.getTime()).toBeLessThan(defaultRange('day').to.getTime());
    const monthly = defaultRange('month');
    expect(monthly.from.getUTCDate()).toBe(1);
  });
});

describe('cache', () => {
  it('stores, reads and expires', () => {
    cache.clear();
    cache.set('dashboard:x', { total: 1 }, 60);
    expect(cache.get('dashboard:x')).toEqual({ total: 1 });

    cache.set('dashboard:y', { total: 2 }, 0);
    expect(cache.get('dashboard:y')).toBeUndefined();
  });

  it('invalidates by prefix only', () => {
    cache.clear();
    cache.set('dashboard:a', 1, 60);
    cache.set('dashboard:b', 2, 60);
    cache.set('facets:a', 3, 60);

    expect(cache.invalidatePrefix('dashboard:')).toBe(2);
    expect(cache.get('dashboard:a')).toBeUndefined();
    expect(cache.get('facets:a')).toBe(3);
  });

  it('wrap() calls the producer once for a warm key', async () => {
    cache.clear();
    let calls = 0;
    const produce = async () => {
      calls += 1;
      return 'value';
    };

    expect(await cache.wrap('dashboard:wrap', 60, produce)).toBe('value');
    expect(await cache.wrap('dashboard:wrap', 60, produce)).toBe('value');
    expect(calls).toBe(1);
  });

  it('wrap() collapses concurrent misses onto one producer', async () => {
    cache.clear();
    let calls = 0;
    const produce = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return 'value';
    };

    // All three miss before any of them can populate the key. Without in-flight
    // deduplication this runs the aggregation three times — the stampede is worst
    // right after an invalidation, which is exactly when the dashboard is busiest.
    const results = await Promise.all([
      cache.wrap('dashboard:stampede', 60, produce),
      cache.wrap('dashboard:stampede', 60, produce),
      cache.wrap('dashboard:stampede', 60, produce),
    ]);

    expect(results).toEqual(['value', 'value', 'value']);
    expect(calls).toBe(1);
  });

  it('wrap() does not cache a rejected producer', async () => {
    cache.clear();
    let calls = 0;
    const produce = async () => {
      calls += 1;
      if (calls === 1) throw new Error('transient');
      return 'value';
    };

    await expect(cache.wrap('dashboard:flaky', 60, produce)).rejects.toThrow('transient');
    // The failure must not be sticky — the next caller retries rather than inheriting it.
    expect(await cache.wrap('dashboard:flaky', 60, produce)).toBe('value');
    expect(calls).toBe(2);
  });

  it('wrap() discards a producer whose key was invalidated mid-flight', async () => {
    cache.clear();
    const produce = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return 'stale';
    };

    const pending = cache.wrap('dashboard:raced', 60, produce);
    // A write lands while the aggregation is still running. Its result describes the
    // world before that write, so caching it would silently undo the invalidation.
    cache.invalidatePrefix('dashboard:');

    expect(await pending).toBe('stale');
    expect(cache.get('dashboard:raced')).toBeUndefined();
  });
});

describe('filter construction', () => {
  it('always scopes doctors to live records', () => {
    expect(buildDoctorFilter({ page: 1, limit: 20 })).toEqual({ deletedAt: null });
  });

  it('turns a search term into anchored, escaped, lowercased token regexes', () => {
    const filter = buildDoctorFilter({ page: 1, limit: 20, search: 'Al.ce' });

    // The dot is escaped, so `.` matches a literal dot rather than any character.
    expect(filter.nameTokens).toEqual({ $all: [/^al/, /^ce/] });
  });

  it('requires every term of a multi-word search to match some token', () => {
    const filter = buildDoctorFilter({ page: 1, limit: 20, search: 'alice ngu' });

    // Narrows to Alice Nguyen rather than returning everyone called Alice.
    expect(filter.nameTokens).toEqual({ $all: [/^alice/, /^ngu/] });
  });

  it('drops a search term with no usable characters instead of matching nothing', () => {
    const filter = buildDoctorFilter({ page: 1, limit: 20, search: '!!!' });

    expect(filter.nameTokens).toBeUndefined();
    expect(filter).toEqual({ deletedAt: null });
  });

  it('carries the doctor filters through', () => {
    const filter = buildDoctorFilter({
      page: 1,
      limit: 20,
      specialization: 'Cardiology',
      hospital: 'Riverside',
      from: new Date('2026-01-01T00:00:00.000Z'),
      to: new Date('2026-01-31T23:59:59.999Z'),
    });

    expect(filter).toMatchObject({
      deletedAt: null,
      specialization: 'Cardiology',
      hospital: 'Riverside',
      createdAt: {
        $gte: new Date('2026-01-01T00:00:00.000Z'),
        $lte: new Date('2026-01-31T23:59:59.999Z'),
      },
    });
  });

  it('scopes patients the same way', () => {
    const filter = buildPatientFilter({
      page: 1,
      limit: 20,
      search: 'Jor',
      condition: 'Asthma',
      doctorId: '64b7f0c2f1a2b3c4d5e6f7a8',
    });

    expect(filter).toMatchObject({
      deletedAt: null,
      condition: 'Asthma',
      doctorId: '64b7f0c2f1a2b3c4d5e6f7a8',
      nameTokens: { $all: [/^jor/] },
    });
  });
});

describe('name tokenisation', () => {
  it('splits a name into lowercased word tokens', () => {
    expect(tokenizeName('Alice Nguyen')).toEqual(['alice', 'nguyen']);
  });

  it('breaks on hyphens and punctuation', () => {
    expect(tokenizeName('Mary-Jane O’Brien')).toEqual(['mary', 'jane', 'o', 'brien']);
  });

  it('de-duplicates repeated words', () => {
    expect(tokenizeName('Hassan Hassan')).toEqual(['hassan']);
  });

  it('keeps non-ASCII letters intact', () => {
    expect(tokenizeName('Zoë Müller')).toEqual(['zoë', 'müller']);
  });

  it('yields nothing for punctuation-only input', () => {
    expect(tokenizeName('!!!')).toEqual([]);
    expect(nameTokenFilter('!!!')).toBeUndefined();
  });
});
