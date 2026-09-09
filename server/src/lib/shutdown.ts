import type { Server } from 'node:http';

/**
 * The slice of Sequelize that shutdown needs. Narrowing it to one method lets
 * the tests pass a fake instead of standing up a database.
 */
export interface PoolCloser {
  close(): Promise<void>;
}

export interface ShutdownDeps {
  server: Server;
  db: PoolCloser;
  /** How long to wait for in-flight requests before giving up. */
  timeoutMs?: number;
  log?: (message: string) => void;
  logError?: (message: string) => void;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Closes the HTTP server, then the database pool, and resolves with the exit
 * code the caller should use: 0 when both closed cleanly, 1 otherwise.
 *
 * Two things here are load-bearing:
 *
 * - **Order.** Closing the pool first would turn the last few in-flight
 *   requests into connection errors, which is the opposite of graceful.
 * - **Both steps always run.** An HTTP close failure is logged and the pool is
 *   closed regardless. Bailing out early would leak the pool in precisely the
 *   case where something has already gone wrong.
 *
 * Returns rather than calling `process.exit` so the whole thing is testable
 * without stubbing out process control; the caller owns the exit.
 */
export async function shutdown({
  server,
  db,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  log = console.log,
  logError = console.error,
}: ShutdownDeps): Promise<number> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const forced = new Promise<number>((resolve) => {
    timer = setTimeout(() => {
      logError(
        `Shutdown timed out after ${timeoutMs}ms with work still in flight — exiting anyway.`,
      );
      resolve(1);
    }, timeoutMs);
    // Unref so the timer can never be the thing keeping an otherwise-drained
    // process alive. If the loop is empty the process exits on its own; if it
    // is not, the timer still fires and forces the issue.
    timer.unref();
  });

  const graceful = (async (): Promise<number> => {
    let code = 0;

    try {
      await closeServer(server);
    } catch (err) {
      logError(`HTTP server did not close cleanly: ${describe(err)}`);
      code = 1;
    }

    try {
      await db.close();
    } catch (err) {
      logError(`Database pool did not close cleanly: ${describe(err)}`);
      code = 1;
    }

    if (code === 0) log('Shutdown complete.');
    return code;
  })();

  try {
    return await Promise.race([graceful, forced]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Registers SIGINT and SIGTERM handlers that shut down once and then exit.
 *
 * SIGTERM is what a container runtime sends and is the reason this exists at
 * all; it is never delivered on Windows, so local verification means Ctrl-C.
 */
export function attachGracefulShutdown(deps: ShutdownDeps): void {
  const log = deps.log ?? console.log;
  let shuttingDown = false;

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      // A second Ctrl-C during a slow drain must not start a second shutdown
      // and race the first one's exit code.
      if (shuttingDown) return;
      shuttingDown = true;

      log(`Received ${signal}, shutting down…`);
      void shutdown(deps).then((code) => {
        process.exit(code);
      });
    });
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });

    // Idle keep-alive sockets — which the Vite proxy and any open browser tab
    // hold — are not active requests, so on older Node versions close() waits
    // for them and shutdown stalls until the force timer fires. Measured on
    // Node 24 close() already drops them and this is a no-op, but the call is
    // idempotent and package.json pins no engine, so it stays: it costs nothing
    // and removes the runtime version as a variable.
    server.closeIdleConnections();
  });
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
