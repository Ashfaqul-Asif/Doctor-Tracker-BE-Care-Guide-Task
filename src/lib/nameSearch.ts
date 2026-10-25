import { escapeRegex } from './escapeRegex.js';

/**
 * Name search: per-word prefix matching, served by a multikey index.
 *
 * Names are split into lowercased word tokens at write time (`nameTokens`), so
 * "Alice Nguyen" is stored as ["alice", "nguyen"]. A search term is tokenised the same
 * way and each token is matched with an **anchored** regex.
 *
 * Anchored is the crucial part: `/^ngu/` against an indexed array is an index prefix
 * scan, the same access path as a range query. A `/ngu/i` regex — unanchored or
 * case-insensitive — cannot use an index at all and degrades to a collection scan.
 * Lowercasing at write time is what lets the read path stay case-sensitive and therefore
 * indexed. See docs/decisions/002-search-and-indexing.md.
 *
 * Consequence: matching is per word, from the start of that word. "nguyen" finds
 * "Alice Nguyen"; "lice" does not.
 */

/** Splits on anything that isn't a letter or digit, so hyphens and punctuation break words. */
export function tokenizeName(name: string): string[] {
  return [
    ...new Set(
      name
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean),
    ),
  ];
}

/**
 * Builds the `nameTokens` predicate for a search term.
 *
 * Multi-word terms require *every* token to prefix-match *some* token of the name, so
 * "alice ngu" narrows to Alice Nguyen rather than returning everyone called Alice.
 * `$all` is used even for a single token to keep one code path — MongoDB rewrites a
 * one-element `$all` into a plain match.
 *
 * Returns `undefined` when the term has no usable characters (e.g. "!!!"), which callers
 * treat as "no name filter" rather than "match nothing".
 */
export function nameTokenFilter(search: string): { $all: RegExp[] } | undefined {
  const tokens = tokenizeName(search);
  if (tokens.length === 0) return undefined;

  return { $all: tokens.map((token) => new RegExp(`^${escapeRegex(token)}`)) };
}
