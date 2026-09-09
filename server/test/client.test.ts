import { describe, it, expect, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import type { RequestHandler } from 'express';
import { createApp } from '../src/app.js';
import { staticClientMiddleware, skipApi } from '../src/client.js';
import { makeFakeTaskModel } from './helpers/fakeTaskModel.js';

/** A stand-in for a `vite build` output: hashed asset, index.html, a root file. */
const fixtureDist = fileURLToPath(new URL('./fixtures/client-dist', import.meta.url));

function appWithClient() {
  return createApp(makeFakeTaskModel(), staticClientMiddleware(fixtureDist));
}

describe('staticClientMiddleware', () => {
  it('serves index.html at the root', async () => {
    const res = await request(appWithClient()).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Fixture Task Board');
  });

  it('serves index.html for a deep client route, so refresh does not 404', async () => {
    const res = await request(appWithClient()).get('/some/client/route');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<div id="root">');
  });

  it('serves hashed assets as immutable', async () => {
    // Vite content-hashes these filenames, so a long immutable cache is safe and
    // is the whole reason the /assets mount is separate.
    const res = await request(appWithClient()).get('/assets/index-abc123.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('hashed-asset');
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('does not let index.html be cached like an asset', async () => {
    // A cached index.html would pin clients to an old asset manifest.
    const res = await request(appWithClient()).get('/');
    expect(res.headers['cache-control']).toContain('no-cache');
  });

  it('serves non-hashed root files without the immutable cache', async () => {
    const res = await request(appWithClient()).get('/favicon.svg');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control'] ?? '').not.toContain('immutable');
  });

  it('leaves an unknown /api path as a JSON 404, not index.html', async () => {
    // The regression that matters: the client layer sits in front of the 404
    // handler, so a fallback that answered everything would turn every API
    // typo into a 200 page and break the client's error handling.
    const res = await request(appWithClient()).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  it('refuses to start without a client build, naming the path and the fix', () => {
    // Otherwise a forgotten `npm run build` surfaces as a 500 on every page
    // load — sendFile's ENOENT reaches the error handler, which reports an
    // internal fault rather than the real, trivially fixable cause.
    const missing = fileURLToPath(new URL('./fixtures/no-such-build', import.meta.url));

    expect(() => staticClientMiddleware(missing)).toThrowError(/npm run build/);
    expect(() => staticClientMiddleware(missing)).toThrowError(/index\.html/);
  });

  it('leaves the API itself reachable', async () => {
    const res = await request(appWithClient()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('declines non-GET requests rather than answering them with HTML', async () => {
    const res = await request(appWithClient()).post('/some/client/route').send({});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('skipApi', () => {
  // Guards the dev path, where the middleware comes from Vite and cannot be
  // told to ignore routes. Without it Vite's SPA fallback answers a mistyped
  // /api path with index.html, so dev and production would disagree.
  const cases: [string, boolean][] = [
    ['/api/tasks', false],
    ['/api', false],
    ['/api/', false],
    ['/', true],
    ['/assets/app.js', true],
    ['/apidocs', true],   // not an API path despite the prefix
  ];

  it.each(cases)('%s -> handler runs: %s', async (path, shouldRun) => {
    const handler = vi.fn<RequestHandler>((_req, res) => { res.status(200).send('client'); });
    const app = createApp(makeFakeTaskModel(), [skipApi(handler)]);

    await request(app).get(path);

    expect(handler).toHaveBeenCalledTimes(shouldRun ? 1 : 0);
  });
});
