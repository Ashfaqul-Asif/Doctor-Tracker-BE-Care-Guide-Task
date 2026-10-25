import type { Schema } from 'mongoose';
import { tokenizeName } from '../../lib/nameSearch.js';

/**
 * Maintains `nameTokens` — the lowercased word tokens of `name` — which is what the
 * search filter queries through a multikey index.
 *
 * Why a denormalised column rather than querying the name directly: a `$regex` with the
 * `i` flag cannot use a b-tree index, and a `$text` index only matches whole words with
 * stemming (searching "ngu" would never find "Nguyen"). Tokenising at write time lets the
 * read path use an anchored, case-sensitive regex — a genuine index prefix scan — while
 * still matching on any word of the name. See docs/decisions/002-search-and-indexing.md.
 *
 * The three hooks below exist because Mongoose writes reach the database by three
 * different routes, and only the first of them runs `save` middleware:
 *   - `doc.save()`                                   → pre('save')
 *   - `Model.insertMany()`                           → pre('insertMany')   ← the seeder
 *   - `findOneAndUpdate` / `updateOne` / `updateMany` → pre(query)
 * Missing any one leaves `nameTokens` silently stale, and a stale index means search
 * quietly stops finding a renamed record — a failure with no error attached to it.
 */
export function searchableName(schema: Schema): void {
  schema.pre('save', function syncOnSave(next) {
    const doc = this as unknown as {
      name?: string;
      nameTokens?: string[];
      isModified(path: string): boolean;
    };
    if (doc.isModified('name') && typeof doc.name === 'string') {
      doc.nameTokens = tokenizeName(doc.name);
    }
    next();
  });

  schema.pre('insertMany', function syncOnInsertMany(next, docs: unknown) {
    if (Array.isArray(docs)) {
      for (const doc of docs) {
        if (doc && typeof doc === 'object') {
          const candidate = doc as { name?: unknown; nameTokens?: string[] };
          if (typeof candidate.name === 'string') {
            candidate.nameTokens = tokenizeName(candidate.name);
          }
        }
      }
    }
    next();
  });

  schema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], function syncOnUpdate(next) {
    const update = this.getUpdate() as Record<string, unknown> | null;
    if (!update) {
      next();
      return;
    }
    const $set = (update.$set ?? {}) as Record<string, unknown>;
    const name = typeof $set.name === 'string' ? $set.name : update.name;
    if (typeof name === 'string') {
      this.set('nameTokens', tokenizeName(name));
    }
    next();
  });
}
