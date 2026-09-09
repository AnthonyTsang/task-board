import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { shutdown, attachGracefulShutdown } from '../src/lib/shutdown.js';

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

const SIGNALS = ['SIGINT', 'SIGTERM'] as const;

type SignalListener = (signal: NodeJS.Signals) => void;

/**
 * Attaches, then hands back the listeners that were added so a test can invoke
 * them directly.
 *
 * Invoking rather than `process.emit('SIGINT')` on purpose: a real emit also
 * fires Vitest's own signal handlers and would tear down the run.
 */
function attachAndCapture(deps: Parameters<typeof attachGracefulShutdown>[0], exit: (code: number) => void) {
  const before = new Map(SIGNALS.map((s) => [s, new Set(process.listeners(s))]));
  attachGracefulShutdown(deps, exit);

  const added = new Map(
    SIGNALS.map((s) => [
      s,
      process.listeners(s).filter((l) => !before.get(s)?.has(l)) as SignalListener[],
    ]),
  );
  registered.push(added);
  return added;
}

const registered: Map<(typeof SIGNALS)[number], SignalListener[]>[] = [];

afterEach(() => {
  // Remove only our own listeners — never removeAllListeners, which would strip
  // Vitest's and break its cleanup.
  for (const added of registered) {
    for (const [signal, listeners] of added) {
      for (const listener of listeners) process.removeListener(signal, listener);
    }
  }
  registered.length = 0;
});

describe('attachGracefulShutdown', () => {
  it('registers a handler for both SIGINT and SIGTERM', () => {
    // SIGTERM is what a container runtime sends and is the reason this exists.
    const { server } = makeFakeServer();
    const added = attachAndCapture({ server, db: makeFakeDb(), ...silent }, () => {});

    expect(added.get('SIGINT')).toHaveLength(1);
    expect(added.get('SIGTERM')).toHaveLength(1);
  });

  it('exits 0 after a clean shutdown', async () => {
    const { server } = makeFakeServer();
    const exit = vi.fn();
    const added = attachAndCapture({ server, db: makeFakeDb(), ...silent }, exit);

    added.get('SIGINT')?.[0]?.('SIGINT');
    await vi.waitFor(() => { expect(exit).toHaveBeenCalledWith(0); });
  });

  it('propagates a failed shutdown as a non-zero exit code', async () => {
    const { server } = makeFakeServer();
    const exit = vi.fn();
    const added = attachAndCapture({ server, db: makeFakeDb('error'), ...silent }, exit);

    added.get('SIGINT')?.[0]?.('SIGINT');
    await vi.waitFor(() => { expect(exit).toHaveBeenCalledWith(1); });
  });

  it('ignores a second signal instead of starting a second shutdown', async () => {
    // A second Ctrl-C during a slow drain must not race the first shutdown's
    // exit code, or close an already-closed pool.
    const { server } = makeFakeServer();
    const db = makeFakeDb();
    const exit = vi.fn();
    const added = attachAndCapture({ server, db, ...silent }, exit);

    const handler = added.get('SIGINT')?.[0];
    handler?.('SIGINT');
    handler?.('SIGINT');
    added.get('SIGTERM')?.[0]?.('SIGTERM');

    await vi.waitFor(() => { expect(exit).toHaveBeenCalled(); });
    expect(db.close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });
});
