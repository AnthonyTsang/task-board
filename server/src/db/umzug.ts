import { Umzug, SequelizeStorage } from 'umzug';
import type { Sequelize, QueryInterface } from 'sequelize';

/**
 * Builds the migrator. Applied migrations are recorded in a SequelizeMeta table
 * inside the database, so `up` is safe to re-run.
 */
export function createMigrator(sequelize: Sequelize): Umzug<QueryInterface> {
  return new Umzug({
    migrations: { glob: ['../migrations/*.ts', { cwd: import.meta.dirname }] },
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize }),
    logger: console,
  });
}
