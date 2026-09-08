import { readFileSync } from 'node:fs';
import { Sequelize } from 'sequelize';
import type { Env } from '../config/env.js';

/**
 * Builds a Sequelize instance. Construction opens no connection — the first
 * query does — so callers may build one without a reachable database.
 *
 * Supabase requires SSL. Its pooler presents a certificate that is not in Node's
 * default trust store, so verification is off unless DB_SSL_CA supplies the CA.
 * That default encrypts the connection but does not verify the server identity.
 */
export function createSequelize(env: Env): Sequelize {
  const ssl = env.dbSslCa
    ? { require: true, rejectUnauthorized: true, ca: readFileSync(env.dbSslCa, 'utf8') }
    : { require: true, rejectUnauthorized: false };

  return new Sequelize({
    dialect: 'postgres',
    host: env.dbHost,
    port: env.dbPort,
    database: env.dbName,
    username: env.dbUser,
    password: env.dbPassword,
    dialectOptions: { ssl },
    logging: false,
  });
}
