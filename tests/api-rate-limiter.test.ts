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

function rateLimitError(retryAfter: string): Error & { status: number; headers: Record<string, string> } {
  return Object.assign(new Error('rate limited'), {
    status: 429,
    headers: { 'Retry-After': retryAfter },
  });
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

  it('enforces the one-minute sliding window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T00:00:00Z'));
    const state = settings({ apiRatePerSecond: 100, apiRatePerMinute: 2, apiRatePerHour: 1000 });
    const limiter = new YuqueApiRateLimiter(() => state, async () => undefined, () => undefined);
    const calls: number[] = [];
    const jobs = [1, 2, 3].map((value) => limiter.schedule(async () => {
      calls.push(value);
      return value;
    }));

    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([1, 2]);
    await vi.advanceTimersByTimeAsync(60_025);
    await expect(Promise.all(jobs)).resolves.toEqual([1, 2, 3]);
    limiter.dispose();
  });

  it('enforces the one-hour sliding window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T00:00:00Z'));
    const state = settings({ apiRatePerSecond: 100, apiRatePerMinute: 100, apiRatePerHour: 2 });
    const limiter = new YuqueApiRateLimiter(() => state, async () => undefined, () => undefined);
    const calls: number[] = [];
    const jobs = [1, 2, 3].map((value) => limiter.schedule(async () => {
      calls.push(value);
      return value;
    }));

    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([1, 2]);
    await vi.advanceTimersByTimeAsync(3_600_025);
    await expect(Promise.all(jobs)).resolves.toEqual([1, 2, 3]);
    limiter.dispose();
  });

  it('pauses the whole queue according to Retry-After after a 429', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T00:00:00Z'));
    const state = settings({ apiRatePerSecond: 100, apiRatePerMinute: 100, apiRatePerHour: 1000 });
    const limiter = new YuqueApiRateLimiter(() => state, async () => undefined, () => undefined);

    await expect(limiter.schedule(async () => {
      throw rateLimitError('2');
    })).rejects.toMatchObject({ status: 429 });

    let ran = false;
    const queued = limiter.schedule(async () => {
      ran = true;
      return 'ok';
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(ran).toBe(false);
    await vi.advanceTimersByTimeAsync(2_025);
    await expect(queued).resolves.toBe('ok');
    limiter.dispose();
  });

  it('does not re-arm 429 timers after dispose', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T00:00:00Z'));
    const state = settings({ apiRatePerSecond: 100, apiRatePerMinute: 100, apiRatePerHour: 1000 });
    const limiter = new YuqueApiRateLimiter(() => state, async () => undefined, () => undefined);
    let rejectActive: ((reason: unknown) => void) | undefined;
    const active = limiter.schedule(() => new Promise<string>((_resolve, reject) => {
      rejectActive = reject;
    }));
    await vi.advanceTimersByTimeAsync(0);
    limiter.dispose();
    rejectActive?.(rateLimitError('30'));
    await expect(active).rejects.toMatchObject({ status: 429 });
    expect(state.apiPausedUntil).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
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
