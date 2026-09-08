import { z } from 'zod';

export interface Env {
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  port: number;
  dbSsl: 'require' | 'disable';
  dbSslCa: string | null;
}

const schema = z.object({
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive(),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  // Defaults to 'require' on purpose: a forgotten DB_SSL in production must not
  // silently drop TLS. An enum rather than a boolean so DB_SSL=false or =off is
  // rejected loudly instead of falling through to a default nobody intended.
  DB_SSL: z.enum(['require', 'disable']).default('require'),
  DB_SSL_CA: z.string().min(1).optional(),
});

/**
 * Validates the environment and returns typed config.
 *
 * Takes its source as a parameter so tests can supply a fake environment, and
 * so nothing is validated at import time — importing this module must stay
 * free of side effects or the model becomes untestable without credentials.
 *
 * @throws Error naming every missing or malformed variable.
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  const e = parsed.data;
  return {
    dbHost: e.DB_HOST,
    dbPort: e.DB_PORT,
    dbName: e.DB_NAME,
    dbUser: e.DB_USER,
    dbPassword: e.DB_PASSWORD,
    port: e.PORT,
    dbSsl: e.DB_SSL,
    dbSslCa: e.DB_SSL_CA ?? null,
  };
}
