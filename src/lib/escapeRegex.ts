/**
 * Search terms reach MongoDB as a `$regex`. Without escaping, a user typing `a.*`
 * would both change the query's meaning and hand us a cheap ReDoS vector.
 */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
