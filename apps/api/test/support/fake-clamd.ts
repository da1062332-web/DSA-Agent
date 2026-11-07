// A clamd stand-in on a local socket, for tests of the real ClamAV client (PING and INSTREAM over TCP). The mode decides the answer:
//   OK     PING answers PONG; a stream is clean.
//   FOUND  PING answers PONG; a stream is infected.
//   DOWN   the connection is closed without an answer, as when clamd is stopped mid-request.
import net from 'node:net';

export type ClamdMode = 'OK' | 'FOUND' | 'DOWN';

export interface FakeClamd {
  readonly port: number;
  mode: ClamdMode;
  stop(): Promise<void>;
}

export async function startFakeClamd(initial: ClamdMode = 'OK'): Promise<FakeClamd> {
  const clamd: { mode: ClamdMode; port: number } = { mode: initial, port: 0 };
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    socket.on('error', () => undefined);
    socket.once('data', (first) => {
      if (first.toString('utf8', 0, 5) === 'zPING') {
        if (clamd.mode === 'DOWN') socket.destroy();
        else socket.end('PONG\0');
        return;
      }
      socket.on('end', () => {
        if (clamd.mode === 'DOWN') return socket.destroy();
        const answer = clamd.mode === 'FOUND' ? 'stream: Eicar-Test-Signature FOUND' : 'stream: OK';
        socket.end(`${answer}\0`);
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  clamd.port = (server.address() as net.AddressInfo).port;
  return {
    get port() {
      return clamd.port;
    },
    get mode() {
      return clamd.mode;
    },
    set mode(next: ClamdMode) {
      clamd.mode = next;
    },
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
