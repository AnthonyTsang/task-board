import { describe, it, expect } from 'vitest';
import { loadEnv } from '../src/config/env.js';

const complete = {
  DB_HOST: 'db.example.supabase.co',
  DB_PORT: '5432',
  DB_NAME: 'postgres',
  DB_USER: 'postgres',
  DB_PASSWORD: 'secret',
};

describe('loadEnv', () => {
  it('parses a complete environment', () => {
    const env = loadEnv(complete);
    expect(env.dbHost).toBe('db.example.supabase.co');
    expect(env.dbPort).toBe(5432);
    expect(env.dbSslCa).toBeNull();
  });

  it('defaults PORT to 3000 when absent', () => {
    expect(loadEnv(complete).port).toBe(3000);
  });

  it('names the missing variable in the error message', () => {
    const { DB_PASSWORD, ...incomplete } = complete;
    expect(() => loadEnv(incomplete)).toThrowError(/DB_PASSWORD/);
  });

  it('rejects a non-numeric DB_PORT', () => {
    expect(() => loadEnv({ ...complete, DB_PORT: 'not-a-number' })).toThrowError(/DB_PORT/);
  });

  it('does not read process.env when a source is supplied', () => {
    // Guards against a module-level `process.env` read sneaking back in.
    expect(() => loadEnv({})).toThrowError();
  });

  describe('DB_SSL', () => {
    it('defaults to require when absent', () => {
      // The load-bearing case: a forgotten DB_SSL in production must not
      // silently drop TLS. This is the invariant most likely to regress.
      expect(loadEnv(complete).dbSsl).toBe('require');
    });

    it('accepts disable, for a local Postgres container that does not speak TLS', () => {
      expect(loadEnv({ ...complete, DB_SSL: 'disable' }).dbSsl).toBe('disable');
    });

    it('accepts an explicit require', () => {
      expect(loadEnv({ ...complete, DB_SSL: 'require' }).dbSsl).toBe('require');
    });

    it.each(['false', 'off', 'no', '0', 'DISABLE', ''])(
      'rejects %o rather than falling through to a default nobody intended',
      (value) => {
        expect(() => loadEnv({ ...complete, DB_SSL: value })).toThrowError(/DB_SSL/);
      },
    );
  });
});
