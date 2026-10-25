import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

let connectionPromise: Promise<typeof mongoose> | null = null;

export async function connectToDatabase(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === mongoose.ConnectionStates.connected) return mongoose;

  // Caught here rather than in the driver: an unedited connection string otherwise
  // surfaces ~15 seconds later as `querySrv ENOTFOUND _mongodb._tcp.<cluster>...`,
  // which reads like a network fault instead of "this was never filled in".
  if (env.hasPlaceholderMongoUri) {
    throw new Error(
      'MONGODB_URI still contains the example placeholders. Open doctor_tracker_BE/.env and ' +
        'replace it with a real connection string (Atlas: Connect → Drivers), ' +
        "substituting your database user's password for <password>.",
    );
  }

  if (!connectionPromise) {
    mongoose.set('strictQuery', true);
    connectionPromise = mongoose.connect(env.mongoUri, {
      dbName: env.mongoDbName,
      serverSelectionTimeoutMS: 15_000,
      maxPoolSize: 20,
    });
  }

  try {
    await connectionPromise;
  } catch (error) {
    connectionPromise = null;
    throw error;
  }

  logger.info({ db: env.mongoDbName }, 'Connected to MongoDB');
  return mongoose;
}

export async function disconnectFromDatabase(): Promise<void> {
  connectionPromise = null;
  await mongoose.disconnect();
}

/**
 * Brings the cluster's indexes in line with what the models declare.
 *
 * Run in dev and test only: in production an index build is an ops decision with a
 * real cost on a populated collection, not something a deploy should trigger silently.
 */
export async function syncAllIndexes(): Promise<void> {
  const models = mongoose.modelNames().map((name) => mongoose.model(name));
  await Promise.all(models.map((model) => model.syncIndexes()));
  logger.info({ models: mongoose.modelNames() }, 'Indexes synced');
}
