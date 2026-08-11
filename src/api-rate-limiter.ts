import type { YuqueSyncSettings } from './types';

export type ApiRequestPriority = 'high' | 'normal' | 'low';

export interface ApiRateLimitSnapshot {
	queued: number;
	active: number;
	secondUsed: number;
	minuteUsed: number;
	hourUsed: number;
	pausedUntil: number;
	last429At: number | null;
}

interface QueuedRequest {
	priority: number;
	sequence: number;
	operation: () => Promise<unknown>;
	resolve: (value: unknown) => void;
	reject: (reason: unknown) => void;
}

interface HttpErrorLike {
	status?: unknown;
	headers?: Record<string, string>;
	response?: {
		status?: unknown;
		headers?: Record<string, string>;
	};
}

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const MAX_ACTIVE_REQUESTS = 2;
const PERSIST_DELAY_MS = 15_000;
const DEFAULT_RATE_LIMIT_PAUSE_MS = 60_000;

const PRIORITY_WEIGHT: Record<ApiRequestPriority, number> = {
	high: 0,
	normal: 1,
	low: 2,
};

function getHttpStatus(error: unknown): number | null {
	if (typeof error !== 'object' || error === null) {
		return null;
	}
	const typed = error as HttpErrorLike;
	if (typeof typed.status === 'number') {
		return typed.status;
	}
	return typeof typed.response?.status === 'number' ? typed.response.status : null;
}

function getHeader(error: unknown, headerName: string): string | undefined {
	if (typeof error !== 'object' || error === null) {
		return undefined;
	}
	const typed = error as HttpErrorLike;
	const headers = [typed.headers, typed.response?.headers].filter(
		(value): value is Record<string, string> => Boolean(value),
	);
	const normalizedName = headerName.toLocaleLowerCase();
	for (const group of headers) {
		for (const [name, value] of Object.entries(group)) {
			if (name.toLocaleLowerCase() === normalizedName) {
				return value;
			}
		}
	}
	return undefined;
}

function parseRetryAfterMs(error: unknown, now: number): number | null {
	const raw = getHeader(error, 'retry-after')?.trim();
	if (!raw) {
		return null;
	}
	const seconds = Number(raw);
	if (Number.isFinite(seconds) && seconds >= 0) {
		return Math.max(SECOND_MS, Math.ceil(seconds * SECOND_MS));
	}
	const retryAt = Date.parse(raw);
	if (!Number.isNaN(retryAt)) {
		return Math.max(SECOND_MS, retryAt - now);
	}
	return null;
}

function normalizeLimit(value: number, fallback: number): number {
	if (!Number.isFinite(value) || value < 1) {
		return fallback;
	}
	return Math.max(1, Math.floor(value));
}

export class YuqueApiRateLimiter {
	private readonly queue: QueuedRequest[] = [];
	private active = 0;
	private sequence = 0;
	private wakeTimer: number | null = null;
	private wakeAt = 0;
	private persistTimer: number | null = null;

	constructor(
		private readonly getSettings: () => YuqueSyncSettings,
		private readonly saveSettings: () => Promise<void>,
		private readonly setStatus: (text: string) => void,
	) {
		this.pruneHistory(Date.now());
	}

	schedule<T>(operation: () => Promise<T>, priority: ApiRequestPriority = 'normal'): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			this.queue.push({
				priority: PRIORITY_WEIGHT[priority],
				sequence: this.sequence,
				operation,
				resolve: (value) => resolve(value as T),
				reject,
			});
			this.sequence += 1;
			this.queue.sort((left, right) => left.priority - right.priority || left.sequence - right.sequence);
			this.pump();
		});
	}

	isRateLimitError(error: unknown): boolean {
		return getHttpStatus(error) === 429;
	}

	getSnapshot(): ApiRateLimitSnapshot {
		const now = Date.now();
		const history = this.pruneHistory(now);
		return {
			queued: this.queue.length,
			active: this.active,
			secondUsed: this.countRecent(history, now - SECOND_MS),
			minuteUsed: this.countRecent(history, now - MINUTE_MS),
			hourUsed: history.length,
			pausedUntil: this.getSettings().apiPausedUntil,
			last429At: this.getSettings().apiLast429At,
		};
	}

	async flush(): Promise<void> {
		if (this.persistTimer !== null) {
			window.clearTimeout(this.persistTimer);
			this.persistTimer = null;
		}
		this.pruneHistory(Date.now());
		await this.saveSettings();
	}

	private pump(): void {
		if (this.queue.length === 0 || this.active >= MAX_ACTIVE_REQUESTS) {
			return;
		}

		const now = Date.now();
		const waitMs = this.getWaitMs(now);
		if (waitMs > 0) {
			this.scheduleWake(waitMs);
			return;
		}

		while (this.queue.length > 0 && this.active < MAX_ACTIVE_REQUESTS) {
			const currentNow = Date.now();
			const nextWait = this.getWaitMs(currentNow);
			if (nextWait > 0) {
				this.scheduleWake(nextWait);
				return;
			}
			const request = this.queue.shift();
			if (!request) {
				return;
			}
			this.recordDispatch(currentNow);
			this.active += 1;
			void request.operation()
				.then(request.resolve, (error: unknown) => {
					if (this.isRateLimitError(error)) {
						this.pauseForRateLimit(error);
					}
					request.reject(error);
				})
				.finally(() => {
					this.active -= 1;
					this.pump();
				});
		}
	}

	private pauseForRateLimit(error: unknown): void {
		const now = Date.now();
		const settings = this.getSettings();
		const retryAfterMs = parseRetryAfterMs(error, now) ?? DEFAULT_RATE_LIMIT_PAUSE_MS;
		settings.apiPausedUntil = Math.max(settings.apiPausedUntil, now + retryAfterMs);
		settings.apiLast429At = now;
		this.setStatus(`语雀 API 已限流，队列暂停至 ${new Date(settings.apiPausedUntil).toLocaleTimeString()}`);
		this.schedulePersist();
		this.scheduleWake(settings.apiPausedUntil - now);
	}

	private getWaitMs(now: number): number {
		const settings = this.getSettings();
		if (settings.apiPausedUntil > now) {
			return settings.apiPausedUntil - now;
		}
		if (settings.apiPausedUntil !== 0 && settings.apiPausedUntil <= now) {
			settings.apiPausedUntil = 0;
			this.schedulePersist();
		}

		const history = this.pruneHistory(now);
		const limits = [
			{ windowMs: SECOND_MS, limit: normalizeLimit(settings.apiRatePerSecond, 2) },
			{ windowMs: MINUTE_MS, limit: normalizeLimit(settings.apiRatePerMinute, 50) },
			{ windowMs: HOUR_MS, limit: normalizeLimit(settings.apiRatePerHour, 4000) },
		];
		let waitMs = 0;
		for (const rule of limits) {
			const threshold = now - rule.windowMs;
			const recent = history.filter((timestamp) => timestamp > threshold);
			if (recent.length >= rule.limit) {
				const releaseAt = recent[recent.length - rule.limit] ?? now;
				waitMs = Math.max(waitMs, releaseAt + rule.windowMs - now + 20);
			}
		}
		return Math.max(0, waitMs);
	}

	private recordDispatch(timestamp: number): void {
		const settings = this.getSettings();
		settings.apiRequestHistory.push(timestamp);
		this.pruneHistory(timestamp);
		this.schedulePersist();
	}

	private pruneHistory(now: number): number[] {
		const settings = this.getSettings();
		const cutoff = now - HOUR_MS;
		const history = settings.apiRequestHistory
			.filter((timestamp) => Number.isFinite(timestamp) && timestamp > cutoff && timestamp <= now + MINUTE_MS)
			.sort((left, right) => left - right);
		if (history.length !== settings.apiRequestHistory.length
			|| history.some((timestamp, index) => timestamp !== settings.apiRequestHistory[index])) {
			settings.apiRequestHistory = history;
		}
		return history;
	}

	private countRecent(history: readonly number[], threshold: number): number {
		let count = 0;
		for (let index = history.length - 1; index >= 0; index -= 1) {
			const timestamp = history[index];
			if (timestamp === undefined || timestamp <= threshold) {
				break;
			}
			count += 1;
		}
		return count;
	}

	private scheduleWake(waitMs: number): void {
		const safeWait = Math.max(20, Math.ceil(waitMs));
		const target = Date.now() + safeWait;
		if (this.wakeTimer !== null && this.wakeAt <= target) {
			return;
		}
		if (this.wakeTimer !== null) {
			window.clearTimeout(this.wakeTimer);
		}
		this.wakeAt = target;
		this.wakeTimer = window.setTimeout(() => {
			this.wakeTimer = null;
			this.wakeAt = 0;
			this.pump();
		}, safeWait);
	}

	private schedulePersist(): void {
		if (this.persistTimer !== null) {
			return;
		}
		this.persistTimer = window.setTimeout(() => {
			this.persistTimer = null;
			void this.saveSettings();
		}, PERSIST_DELAY_MS);
	}
}
