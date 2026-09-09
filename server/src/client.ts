import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type RequestHandler } from 'express';

export type ClientMode = 'development' | 'production';

/**
 * The repository root, resolved from this module rather than process.cwd() so
 * it does not depend on where the server was started from.
 *
 * The same expression works in both trees because tsconfig.build.json maps
 * `rootDir: "src"` to `outDir: "dist"`, preserving depth: src/client.ts and
 * dist/client.js are both one level under server/. Changing either field
 * breaks this.
 */
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const clientRoot = join(repoRoot, 'client');
const clientDist = join(clientRoot, 'dist');

/**
 * Requests the client layer must never touch.
 *
 * Without this, Vite's SPA fallback rewrites any unmatched GET that accepts
 * text/html — including a mistyped /api/taks from a browser — to index.html,
 * so a bad API path would return 200 HTML in development and a JSON 404 in
 * production. Skipping /api entirely keeps the two modes identical.
 */
function isApiPath(path: string): boolean {
  return path === '/api' || path.startsWith('/api/');
}

/** Serves the built client. Vite's filenames are content-hashed, so everything
 * under /assets is immutable; index.html never is, or clients would pin an old
 * asset manifest forever. */
export function staticClientMiddleware(distDir: string = clientDist): RequestHandler[] {
  const indexHtml = join(distDir, 'index.html');

  // A Router rather than loose handlers: the /assets mount path only exists if
  // something carries it. Returned as bare middleware, the assets static would
  // be mounted at "/" by the caller and look for dist/assets/assets/*, missing
  // every file and silently handing them to the un-cached static below.
  const router = express.Router();

  router.use('/assets', express.static(join(distDir, 'assets'), { immutable: true, maxAge: '1y' }));

  // index: false so a bare "/" falls through to the handler below, which is the
  // single place index.html is served from.
  router.use(express.static(distDir, { index: false }));

  router.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (isApiPath(req.path)) return next();

    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml, (err: unknown) => { if (err) next(err); });
  });

  return [router];
}

/**
 * Wraps middleware so it never sees an /api request. Exported for the dev path,
 * where the middleware comes from Vite and cannot be told to skip routes.
 */
export function skipApi(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    if (isApiPath(req.path)) return next();
    handler(req, res, next);
  };
}

/**
 * Runs Vite in middleware mode, giving transforms and HMR on the same origin
 * and port as the API — no proxy, no second server.
 *
 * Vite is imported dynamically so production never loads it: `npm start` runs
 * the compiled output with devDependencies absent, and a static import would
 * fail at startup there.
 */
export async function devClientMiddleware(root: string = clientRoot): Promise<RequestHandler[]> {
  const { createServer } = await import('vite');

  const vite = await createServer({
    root,
    appType: 'spa',
    server: { middlewareMode: true },
  });

  return [skipApi(vite.middlewares as unknown as RequestHandler)];
}

/** Picks the client layer for the mode the server was started in. */
export async function createClientMiddleware(mode: ClientMode): Promise<RequestHandler[]> {
  return mode === 'development' ? devClientMiddleware() : staticClientMiddleware();
}
