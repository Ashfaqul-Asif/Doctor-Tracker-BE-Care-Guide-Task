import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectToDatabase, disconnectFromDatabase, syncAllIndexes } from './db/connect.js';
import { cache } from './lib/cache.js';
import { logger } from './lib/logger.js';

async function main(): Promise<void> {
  await connectToDatabase();

  if (!env.isProduction) {
    await syncAllIndexes();
  }

  cache.startSweeper();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`Doctor Tracker API listening on http://localhost:${env.PORT}`);
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close(() => {
      void disconnectFromDatabase().finally(() => process.exit(0));
    });
    // Don't let an open keep-alive connection hold the process forever.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  // Also written straight to stderr, not only through the logger: pino's pretty
  // transport runs in a worker thread, and a process that exits immediately can take
  // the worker with it before it flushes — which turns a boot failure into a silent
  // exit and a browser showing nothing but "site can't be reached".
  console.error(`\nThe API failed to start.\n\n  ${message}\n`);

  if (/ENOTFOUND|ECONNREFUSED|querySrv|ServerSelection/i.test(message)) {
    console.error(
      '  This looks like the database being unreachable. Check MONGODB_URI in\n' +
        '  doctor_tracker_BE/.env, and that your IP is allowlisted under Atlas → Network Access.\n',
    );
  }

  logger.error({ err: error }, 'Failed to start the API');
  process.exit(1);
});
