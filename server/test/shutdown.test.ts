import { describe, it, expect, vi } from 'vitest';
import type { Server } from 'node:http';
import { shutdown } from '../src/lib/shutdown.js';

/**
 * A server that records the order of calls and lets each test decide how
 * `close()` settles: cleanly, with an error, or never.
 */
function makeFakeServer(
  behaviour: 'clean' | 'error' | 'hang' = 'clean',
  calls: string[] = [],
) {
  const server = {
    close: vi.fn((cb: (err?: Error) => void) => {
      if (behaviour === 'hang') return;
      calls.push('server.close');
      cb(behaviour === 'error' ? new Error('sockets still attached') : undefined);
    }),
    closeIdleConnections: vi.fn(() => {
      calls.push('server.closeIdleConnections');
    }),
  };
  return { server: server as unknown as Server, spies: server, calls };
}

function makeFakeDb(behaviour: 'clean' | 'error' = 'clean', calls: string[] = []) {
  return {
    close: vi.fn(async () => {
      calls.push('db.close');
      if (behaviour === 'error') throw new Error('pool drain failed');
    }),
  };
}

const silent = { log: () => {}, logError: () => {} };

describe('shutdown', () => {
  it('resolves 0 when both the server and the pool close cleanly', async () => {
    const { server } = makeFakeServer();
    await expect(shutdown({ server, db: makeFakeDb(), ...silent })).resolves.toBe(0);
  });

  it('closes the HTTP server before the database pool', async () => {
    // Reversing these would turn the last in-flight requests into connection
    // errors — the opposite of a graceful shutdown.
    const calls: string[] = [];
    const { server } = makeFakeServer('clean', calls);
    await shutdown({ server, db: makeFakeDb('clean', calls), ...silent });

    expect(calls.indexOf('server.close')).toBeLessThan(calls.indexOf('db.close'));
  });

  it('closes idle keep-alive connections', async () => {
    // Defensive: Node 24's close() drops idle sockets on its own, but older
    // runtimes wait for them and stall shutdown until the force timer fires.
    // package.json pins no engine, so the call must not be dropped as dead code.
    const { server, spies } = makeFakeServer();
    await shutdown({ server, db: makeFakeDb(), ...silent });

    expect(spies.closeIdleConnections).toHaveBeenCalledTimes(1);
  });

  it('still closes the pool when the HTTP server fails to close', async () => {
    // Bailing out early would leak the pool in exactly the case where something
    // has already gone wrong.
    const { server } = makeFakeServer('error');
    const db = makeFakeDb();

    await expect(shutdown({ server, db, ...silent })).resolves.toBe(1);
    expect(db.close).toHaveBeenCalledTimes(1);
  });

  it('resolves 1 when the pool fails to close', async () => {
    const { server } = makeFakeServer();
    await expect(shutdown({ server, db: makeFakeDb('error'), ...silent })).resolves.toBe(1);
  });

  it('resolves 1 once the timeout elapses rather than hanging forever', async () => {
    const { server } = makeFakeServer('hang');
    const logError = vi.fn();

    await expect(
      shutdown({ server, db: makeFakeDb(), timeoutMs: 10, log: () => {}, logError }),
    ).resolves.toBe(1);
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('timed out'));
  });

  it('reports the underlying reason when a close fails', async () => {
    const { server } = makeFakeServer('error');
    const logError = vi.fn();

    await shutdown({ server, db: makeFakeDb(), log: () => {}, logError });

    expect(logError).toHaveBeenCalledWith(expect.stringContaining('sockets still attached'));
  });
});
