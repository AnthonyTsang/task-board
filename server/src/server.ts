import { loadEnv } from './config/env.js';
import { createSequelize } from './db/sequelize.js';
import { initTaskModel } from './models/Task.js';
import { createApp } from './app.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const sequelize = createSequelize(env);

  // Fail fast on a bad connection rather than at the first request.
  await sequelize.authenticate();

  const taskModel = initTaskModel(sequelize);
  const app = createApp(taskModel);

  app.listen(env.port, () => {
    console.log(`API listening on http://localhost:${env.port}`);
  });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
