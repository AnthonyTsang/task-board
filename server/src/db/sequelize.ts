import { readFileSync } from 'node:fs';
import { Sequelize, type Options } from 'sequelize';
import type { Env } from '../config/env.js';

/**
 * Builds a Sequelize instance. Construction opens no connection — the first
 * query does — so callers may build one without a reachable database.
 *
 * TLS has three modes, driven by DB_SSL and DB_SSL_CA:
 *
 *   require + DB_SSL_CA   encrypted and the server's identity is verified
 *   require (default)     encrypted, identity NOT verified
 *   disable               no TLS at all
 *
 * `require` without a CA is the Supabase default: its pooler presents a
 * certificate that is not in Node's default trust store, so verification is off
 * unless DB_SSL_CA supplies one. That encrypts the connection but leaves it
 * theoretically open to a man-in-the-middle.
 *
 * `disable` exists for a local Postgres container, which does not speak TLS.
 * It is never appropriate for a hosted database, which is why `require` is the
 * default — forgetting to set DB_SSL must not silently drop TLS in production.
 */
export function createSequelize(env: Env): Sequelize {
  const options: Options = {
    dialect: 'postgres',
    host: env.dbHost,
    port: env.dbPort,
    database: env.dbName,
    username: env.dbUser,
    password: env.dbPassword,
    logging: false,
  };

  // Omit dialectOptions.ssl entirely when disabled rather than passing `ssl: false`.
  // Absent is unambiguous and will not shift meaning under a pg driver bump.
  if (env.dbSsl === 'require') {
    options.dialectOptions = {
      ssl: env.dbSslCa
        ? { require: true, rejectUnauthorized: true, ca: readFileSync(env.dbSslCa, 'utf8') }
        : { require: true, rejectUnauthorized: false },
    };
  }

  return new Sequelize(options);
}
