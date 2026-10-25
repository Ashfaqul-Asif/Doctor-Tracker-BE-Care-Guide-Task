import mongoose from 'mongoose';
import { connectToDatabase, disconnectFromDatabase, syncAllIndexes } from '../../src/db/connect.js';

// Importing the models registers them on the connection, which is what makes
// `syncAllIndexes()` below actually create the compound indexes under test.
import '../../src/models/Doctor.js';
import '../../src/models/Patient.js';
import '../../src/models/Session.js';
import '../../src/models/User.js';

export async function setupTestDatabase(): Promise<void> {
  await connectToDatabase();
  // Clearing *before* syncing indexes, not just between cases: a unique index cannot be
  // built over rows that already violate it, so data left behind by a run that predates
  // the constraint would otherwise fail every subsequent setup.
  await clearCollections();
  await syncAllIndexes();
}

/**
 * Between cases the data goes, the indexes stay — recreating indexes per test would
 * dominate the suite's runtime against a remote Atlas cluster.
 */
export async function clearCollections(): Promise<void> {
  const collections = Object.values(mongoose.connection.collections);
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
}

export async function teardownTestDatabase(): Promise<void> {
  await disconnectFromDatabase();
}
