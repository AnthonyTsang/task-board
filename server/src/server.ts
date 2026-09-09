import { loadEnv } from './config/env.js';
import { createSequelize } from './db/sequelize.js';
import { initTaskModel } from './models/Task.js';
import { createApp } from './app.js';
import { attachGracefulShutdown } from './lib/shutdown.js';
import { createClientMiddleware } from './client.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const sequelize = createSequelize(env);

  // Fail fast on a bad connection rather than at the first request.
  await sequelize.authenticate();

  const taskModel = initTaskModel(sequelize);

  // The mode comes from the invocation, not from .env: the same .env is copied
  // between the local and Supabase templates, so putting the switch there would
  // let a template copy silently change how the client is served.
  const mode = process.argv.includes('--dev') ? 'development' : 'production';
  const app = createApp(taskModel, await createClientMiddleware(mode));

  const server = app.listen(env.port, "0.0.0.0", () => {
    console.log(`Task board (${mode}) on http://localhost:${env.port}`);
  });

  // listen() doesn't throw synchronously on a bind failure — it emits 'error'
  // on the returned server. Without this handler that becomes an uncaught
  // exception and dumps a stack trace instead of the clean message every
  // other failure mode in this file produces.
  server.on('error', (err: Error) => {
    console.error(`Failed to bind port ${env.port}: ${err.message}`);
    process.exit(1);
  });

  // Drain in-flight requests and close the connection pool on SIGINT/SIGTERM.
  attachGracefulShutdown({ server, db: sequelize });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
