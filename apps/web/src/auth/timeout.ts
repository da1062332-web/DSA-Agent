// Rejects if the promise has not settled in `ms`. Used for sign-in: a stuck auth request (for example one waiting on a lock
// held by another open tab) must not leave the button on "Authenticating..." forever.
export class TimeoutError extends Error {
  constructor() {
    super('timed out');
    this.name = 'TimeoutError';
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
