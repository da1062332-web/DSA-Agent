// Runs the unit suite with the system clock set to a chosen date (FAKE_NOW, default far in the future), to catch tests that only
// pass while a hard-coded calendar date is still ahead of (or behind) today. Run: npm run test:future-clock -w @dsa/api
import { vi } from 'vitest';

vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date(process.env.FAKE_NOW ?? '2032-02-29T23:59:00Z'));
