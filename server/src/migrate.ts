import { loadEnv } from './config/env.js';
import { createSequelize } from './db/sequelize.js';
import { createMigrator } from './db/umzug.js';

async function main(): Promise<void> {
  const direction = process.argv[2] ?? 'up';
  if (direction !== 'up' && direction !== 'down') {
    throw new Error(`Unknown migration direction "${direction}" — expected "up" or "down"`);
  }

  const sequelize = createSequelize(loadEnv());
  const migrator = createMigrator(sequelize);

  const applied = direction === 'up'
    ? await migrator.up()
    : await migrator.down();

  console.log(
    applied.length === 0
      ? 'No migrations to run.'
      : `Applied: ${applied.map((m) => m.name).join(', ')}`,
  );

  await sequelize.close();
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
