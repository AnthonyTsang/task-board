import { loadEnv } from './config/env.js';
import { createSequelize } from './db/sequelize.js';
import { initTaskModel } from './models/Task.js';
import { createApp } from './app.js';
import { attachGracefulShutdown } from './lib/shutdown.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const sequelize = createSequelize(env);

  // Fail fast on a bad connection rather than at the first request.
  await sequelize.authenticate();

  const taskModel = initTaskModel(sequelize);
  const app = createApp(taskModel);

  const server = app.listen(env.port, () => {
    console.log(`API listening on http://localhost:${env.port}`);
  });

  // listen() doesn't throw synchronously on a bind failure — it emits 'error'
  // on the returned server. Without this handler that becomes an uncaught
  // exception and dumps a stack trace instead of the clean message every
  // other failure mode in this file produces.
  server.on('error', (err: Error) => {
    console.error(`HTTP server error (port ${env.port}): ${err.message}`);
    process.exit(1);
  });

  // Drain in-flight requests and close the connection pool on SIGINT/SIGTERM.
  attachGracefulShutdown({ server, db: sequelize });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
