import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { YuqueApiRateLimiter } from '../src/api-rate-limiter';
import { DEFAULT_SETTINGS, type YuqueSyncSettings } from '../src/types';

function settings(overrides: Partial<YuqueSyncSettings> = {}): YuqueSyncSettings {
  return {
    ...DEFAULT_SETTINGS,
    pendingCreates: {},
    syncIndex: {},
    dirtyFiles: [],
    apiRequestHistory: [],
    ...overrides,
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(globalThis, 'window');
});

describe('YuqueApiRateLimiter', () => {
  it('holds the third request until the one-second window opens', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T00:00:00Z'));
    const state = settings({ apiRatePerSecond: 2, apiRatePerMinute: 100, apiRatePerHour: 1000 });
    const limiter = new YuqueApiRateLimiter(() => state, async () => undefined, () => undefined);
    const calls: number[] = [];

    const jobs = [1, 2, 3].map((value) => limiter.schedule(async () => {
      calls.push(value);
      return value;
    }));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([1, 2]);

    await vi.advanceTimersByTimeAsync(1025);
    await expect(Promise.all(jobs)).resolves.toEqual([1, 2, 3]);
    expect(calls).toEqual([1, 2, 3]);
    limiter.dispose();
  });

  it('removes an aborted queued scan request', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T00:00:00Z'));
    const state = settings({ apiRatePerSecond: 1, apiRatePerMinute: 100, apiRatePerHour: 1000 });
    const limiter = new YuqueApiRateLimiter(() => state, async () => undefined, () => undefined);
    await limiter.schedule(async () => 'first');

    const controller = new AbortController();
    const queued = limiter.schedule(async () => 'second', 'low', controller.signal);
    controller.abort();
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    expect(limiter.getSnapshot().queued).toBe(0);
    limiter.dispose();
  });

  it('dispose rejects pending requests and clears the queue', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T00:00:00Z'));
    const state = settings({ apiRatePerSecond: 1, apiRatePerMinute: 100, apiRatePerHour: 1000 });
    const limiter = new YuqueApiRateLimiter(() => state, async () => undefined, () => undefined);
    await limiter.schedule(async () => 'first');
    const pending = limiter.schedule(async () => 'second', 'low');
    limiter.dispose();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(limiter.getSnapshot().queued).toBe(0);
  });
});
