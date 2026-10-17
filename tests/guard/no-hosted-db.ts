// Fail-closed guard for integration and isolation tests (setupFiles). These suites are meant to run against throwaway
// Testcontainers databases. Some specs read DATABASE_URL from apps/api/.env, or fall back to a connection string written
// in the spec, and would then write to the shared hosted Supabase project. This refuses every outgoing TCP connection
// whose host is not the local machine, before any DNS lookup or network traffic, so a test cannot reach hosted by accident.
// Unix sockets and named pipes (the Docker daemon) are allowed. There is deliberately no opt-out switch.
import net from 'node:net';

const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|::1|\[::1\]|0\.0\.0\.0|::ffff:127(\.\d{1,3}){3})$/i;

type ConnectArgs = unknown[];

/** The host a socket.connect() call is about to use, or undefined when it is local, a path, or not stated. */
export function remoteHostOf(args: ConnectArgs): string | undefined {
  const first = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];
  let host: unknown;
  if (first && typeof first === 'object') {
    const o = first as { host?: unknown; path?: unknown };
    if (typeof o.path === 'string') return undefined;
    host = o.host;
  } else if (typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))) {
    host = args[1];
  } else {
    return undefined; // a pipe or unix socket path
  }
  if (typeof host !== 'string' || host === '') return undefined; // node defaults to localhost
  return LOOPBACK.test(host) ? undefined : host;
}

const realConnect = net.Socket.prototype.connect;

net.Socket.prototype.connect = function guardedConnect(this: net.Socket, ...args: ConnectArgs) {
  const host = remoteHostOf(args);
  if (host !== undefined) {
    const err = new Error(
      `Refused by the test guard: a test tried to connect to "${host}". Integration and isolation tests may only use ` +
        `local databases (Testcontainers). A spec that reads DATABASE_URL or embeds a hosted URL must be pointed at a container.`,
    );
    (err as NodeJS.ErrnoException).code = 'EHOSTEDGUARD';
    process.nextTick(() => this.destroy(err));
    return this;
  }
  return (realConnect as (...a: ConnectArgs) => net.Socket).apply(this, args);
} as typeof net.Socket.prototype.connect;
