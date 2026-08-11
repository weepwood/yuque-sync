import { App, TFile } from 'obsidian';
import {
	describeError,
	extractYuqueLocation,
	getStringProperty,
	isYuqueSyncDisabled,
	normalizeMarkdownForComparison,
	readFrontmatter,
	splitMarkdown,
} from './markdown-utils';
import type {
	ScanMode,
	ScanSummary,
	SyncIndexEntry,
	SyncScanResult,
	SyncStatus,
	YuqueSyncSettings,
} from './types';
import type { YuqueClient } from './yuque-client';

const INDEX_SAVE_INTERVAL = 500;
const DIRTY_SAVE_DELAY_MS = 1500;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 750;

interface ScanPlan {
	paths: string[];
	remoteRequired: Set<string>;
	remoteMetadataHits: number;
}

interface ScanFileResult {
	entry: SyncIndexEntry;
	remoteRequest: boolean;
}

interface LocalSnapshot {
	content: string;
	mtime: number;
	size: number;
}

export interface SyncScanReport {
	results: SyncScanResult[];
	summary: ScanSummary;
}

function getHttpStatus(error: unknown): number | null {
	if (typeof error !== 'object' || error === null) {
		return null;
	}
	const directStatus = (error as { status?: unknown }).status;
	if (typeof directStatus === 'number') {
		return directStatus;
	}
	const responseStatus = (error as { response?: { status?: unknown } }).response?.status;
	return typeof responseStatus === 'number' ? responseStatus : null;
}

function isRetryable(error: unknown): boolean {
	const status = getHttpStatus(error);
	// HTTP 429 由 YuqueClient 的全局限流队列统一处理，避免 worker 重复退避。
	return status !== null && status >= 500 && status <= 599;
}

function sleep(milliseconds: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
	let lastError: unknown;
	for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
		try {
			return await operation();
		} catch (error) {
			lastError = error;
			if (!isRetryable(error) || attempt === MAX_RETRIES) {
				throw error;
			}
			const jitter = Math.floor(Math.random() * 250);
			await sleep(RETRY_BASE_DELAY_MS * (2 ** attempt) + jitter);
		}
	}
	throw lastError;
}

async function hashMarkdownBody(content: string): Promise<string> {
	const normalized = normalizeMarkdownForComparison(splitMarkdown(content).body);
	const bytes = new TextEncoder().encode(normalized);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

function classifyHashes(
	localHash: string,
	remoteHash: string,
	baseline: string | undefined,
): { status: SyncStatus; baseline: string | undefined } {
	if (localHash === remoteHash) {
		return { status: 'synced', baseline: localHash };
	}
	if (!baseline) {
		return { status: 'different', baseline: undefined };
	}

	const localChanged = localHash !== baseline;
	const remoteChanged = remoteHash !== baseline;
	if (localChanged && remoteChanged) {
		return { status: 'conflict', baseline };
	}
	if (localChanged) {
		return { status: 'local-changed', baseline };
	}
	if (remoteChanged) {
		return { status: 'remote-changed', baseline };
	}
	return { status: 'different', baseline };
}

function statusDetail(status: SyncStatus): string | undefined {
	switch (status) {
		case 'local-changed':
			return '仅本地正文相对最近同步基线发生变化';
		case 'remote-changed':
			return '仅语雀正文相对最近同步基线发生变化';
		case 'conflict':
			return '本地与语雀都已变化，需要人工确认同步方向';
		case 'different':
			return '两端正文不同，但尚未建立最近同步基线';
		case 'unchecked':
			return '已建立本地索引，等待远端正文校验';
		default:
			return undefined;
	}
}

export class SyncEngine {
	private dirtyPaths: Set<string>;
	private saveTimer: number | null = null;
	private scanning = false;
	private cancelRequested = false;

	constructor(
		private readonly app: App,
		private readonly client: YuqueClient,
		private readonly getSettings: () => YuqueSyncSettings,
		private readonly saveSettings: () => Promise<void>,
		private readonly isExcludedFile: (file: TFile) => boolean,
		private readonly setStatus: (text: string) => void,
	) {
		this.dirtyPaths = new Set(this.getSettings().dirtyFiles);
	}

	markDirty(path: string): void {
		this.dirtyPaths.add(path);
		this.schedulePersist();
	}

	renamePath(oldPath: string, newPath: string): void {
		const settings = this.getSettings();
		const entry = settings.syncIndex[oldPath];
		if (entry) {
			settings.syncIndex[newPath] = { ...entry, path: newPath };
			delete settings.syncIndex[oldPath];
		}
		const pending = settings.pendingCreates[oldPath];
		if (pending) {
			settings.pendingCreates[newPath] = pending;
			delete settings.pendingCreates[oldPath];
		}
		if (this.dirtyPaths.delete(oldPath)) {
			this.dirtyPaths.add(newPath);
		} else {
			this.dirtyPaths.add(newPath);
		}
		if (settings.scanSession) {
			settings.scanSession.pendingPaths = settings.scanSession.pendingPaths
				.map((path) => path === oldPath ? newPath : path);
			settings.scanSession.remoteRequiredPaths = settings.scanSession.remoteRequiredPaths
				.map((path) => path === oldPath ? newPath : path);
		}
		this.schedulePersist();
	}

	removePath(path: string): void {
		const settings = this.getSettings();
		delete settings.syncIndex[path];
		delete settings.pendingCreates[path];
		this.dirtyPaths.delete(path);
		if (settings.scanSession) {
			settings.scanSession.pendingPaths = settings.scanSession.pendingPaths.filter((item) => item !== path);
			settings.scanSession.remoteRequiredPaths = settings.scanSession.remoteRequiredPaths
				.filter((item) => item !== path);
		}
		this.schedulePersist();
	}

	cancelScan(): boolean {
		if (!this.scanning) {
			return false;
		}
		this.cancelRequested = true;
		return true;
	}

	async flush(): Promise<void> {
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		await this.persistNow();
	}

	async scan(mode: ScanMode): Promise<SyncScanReport> {
		const startedAt = Date.now();
		this.cancelRequested = false;
		this.scanning = true;

		try {
			const files = this.app.vault.getMarkdownFiles().filter((file) => !this.isExcludedFile(file));
			const filesByPath = new Map(files.map((file) => [file.path, file]));
			this.pruneMissingEntries(filesByPath);

			const settings = this.getSettings();
			let resumed = false;
			let plan: ScanPlan;
			const session = settings.scanSession;
			if (session?.mode === mode && session.pendingPaths.length > 0) {
				const pendingPaths = session.pendingPaths.filter((path) => filesByPath.has(path));
				const remoteRequired = new Set(session.remoteRequiredPaths.filter((path) => filesByPath.has(path)));
				plan = { paths: pendingPaths, remoteRequired, remoteMetadataHits: 0 };
				resumed = pendingPaths.length > 0;
			} else {
				plan = mode === 'full'
					? {
						paths: files.map((file) => file.path),
						remoteRequired: new Set(files.map((file) => file.path)),
						remoteMetadataHits: 0,
					}
					: await this.buildIncrementalPlan(files);
				settings.scanSession = {
					mode,
					total: plan.paths.length,
					completed: 0,
					pendingPaths: [...plan.paths],
					remoteRequiredPaths: [...plan.remoteRequired],
					startedAt,
				};
				await this.persistNow();
			}

			const remaining = new Set(plan.paths);
			let scanned = 0;
			let remoteBodyRequests = 0;
			let cursor = 0;
			const concurrency = Math.max(1, Math.min(8, Math.floor(settings.scanConcurrency || 4)));

			const worker = async (): Promise<void> => {
				while (!this.cancelRequested) {
					const currentIndex = cursor;
					cursor += 1;
					if (currentIndex >= plan.paths.length) {
						return;
					}
					const path = plan.paths[currentIndex];
					if (!path) {
						continue;
					}
					const file = filesByPath.get(path);
					if (!file) {
						remaining.delete(path);
						continue;
					}

					const completedBefore = scanned;
					this.setStatus(`正在${mode === 'full' ? '完整' : '增量'}检测 ${completedBefore + 1}/${plan.paths.length}：${file.path}`);
					let snapshotStable = false;
					try {
						const result = await this.scanFile(file, mode, mode === 'full' || plan.remoteRequired.has(path));
						settings.syncIndex[path] = result.entry;
						snapshotStable = file.stat.mtime === result.entry.mtime && file.stat.size === result.entry.size;
						if (result.remoteRequest) {
							remoteBodyRequests += 1;
						}
					} catch (error) {
						settings.syncIndex[path] = {
							path,
							mtime: file.stat.mtime,
							size: file.stat.size,
							status: 'error',
							lastCheckedAt: Date.now(),
							detail: describeError(error),
						};
					}
					if (snapshotStable) {
						this.dirtyPaths.delete(path);
					} else {
						this.dirtyPaths.add(path);
					}
					remaining.delete(path);
					scanned += 1;

					if (scanned % INDEX_SAVE_INTERVAL === 0 || remaining.size === 0) {
						await this.persistSessionProgress(remaining, plan.remoteRequired);
					}
				}
			};

			const workers = Array.from(
				{ length: Math.min(concurrency, Math.max(1, plan.paths.length)) },
				() => worker(),
			);
			await Promise.all(workers);

			const canceled = this.cancelRequested && remaining.size > 0;
			if (canceled) {
				await this.persistSessionProgress(remaining, plan.remoteRequired);
			} else {
				settings.scanSession = null;
				await this.persistNow();
			}

			const results = files.map((file) => this.toScanResult(file));
			return {
				results,
				summary: {
					mode,
					total: files.length,
					scanned,
					cached: Math.max(0, files.length - scanned),
					resumed,
					canceled,
					durationMs: Date.now() - startedAt,
					remoteMetadataHits: plan.remoteMetadataHits,
					remoteBodyRequests,
				},
			};
		} finally {
			this.scanning = false;
			this.cancelRequested = false;
			this.schedulePersist();
		}
	}

	async recordSynchronized(
		file: TFile,
		yuqueLink: string,
		content?: string,
		remoteUpdatedAt = '',
	): Promise<void> {
		const snapshot = await this.readStableSnapshot(file);
		const baselineContent = content ?? snapshot.content;
		const baselineHash = await hashMarkdownBody(baselineContent);
		const localHash = await hashMarkdownBody(snapshot.content);
		const status: SyncStatus = localHash === baselineHash ? 'synced' : 'local-changed';
		const now = Date.now();
		this.getSettings().syncIndex[file.path] = {
			path: file.path,
			mtime: snapshot.mtime,
			size: snapshot.size,
			status,
			yuqueLink,
			localHash,
			remoteHash: baselineHash,
			lastSyncedHash: baselineHash,
			remoteUpdatedAt: remoteUpdatedAt || undefined,
			remoteCheckedAt: now,
			lastCheckedAt: now,
			detail: statusDetail(status),
		};
		this.reconcileDirtyPath(file, snapshot);
		await this.persistNow();
	}

	async recordRemoteComparison(
		file: TFile,
		yuqueLink: string,
		remoteContent: string,
		remoteUpdatedAt: string,
	): Promise<void> {
		const snapshot = await this.readStableSnapshot(file);
		const localHash = await hashMarkdownBody(snapshot.content);
		const remoteHash = await hashMarkdownBody(remoteContent);
		const previous = this.getSettings().syncIndex[file.path];
		const previousForLink = previous?.yuqueLink === yuqueLink ? previous : undefined;
		const classification = classifyHashes(localHash, remoteHash, previousForLink?.lastSyncedHash);
		const now = Date.now();
		this.getSettings().syncIndex[file.path] = {
			path: file.path,
			mtime: snapshot.mtime,
			size: snapshot.size,
			status: classification.status,
			yuqueLink,
			localHash,
			remoteHash,
			lastSyncedHash: classification.baseline,
			remoteUpdatedAt: remoteUpdatedAt || undefined,
			remoteCheckedAt: now,
			lastCheckedAt: now,
			detail: statusDetail(classification.status),
		};
		this.reconcileDirtyPath(file, snapshot);
		await this.persistNow();
	}

	private async buildIncrementalPlan(files: TFile[]): Promise<ScanPlan> {
		const settings = this.getSettings();
		const planned = new Map<string, boolean>();
		for (const file of files) {
			const entry = settings.syncIndex[file.path];
			if (!entry) {
				// 首次建立索引只读本地，不立即为每篇文档发远端请求。
				planned.set(file.path, false);
				continue;
			}
			if (this.dirtyPaths.has(file.path) || entry.mtime !== file.stat.mtime || entry.size !== file.stat.size) {
				planned.set(file.path, Boolean(entry.yuqueLink));
			}
		}

		const remoteRefresh = await this.refreshRemoteCandidates(files, planned);
		for (const path of remoteRefresh.remoteRequired) {
			planned.set(path, true);
		}

		return {
			paths: [...planned.keys()],
			remoteRequired: new Set(
				[...planned.entries()].filter(([, required]) => required).map(([path]) => path),
			),
			remoteMetadataHits: remoteRefresh.metadataHits,
		};
	}

	private async refreshRemoteCandidates(
		files: TFile[],
		alreadyPlanned: ReadonlyMap<string, boolean>,
	): Promise<{ remoteRequired: Set<string>; metadataHits: number }> {
		const settings = this.getSettings();
		const ttlMs = Math.max(1, settings.remoteCheckTtlHours || 24) * 60 * 60 * 1000;
		const now = Date.now();
		const groups = new Map<string, Array<{ path: string; slug: string }>>();
		const fallback = new Set<string>();
		const remoteRequired = new Set<string>();
		let metadataHits = 0;

		for (const file of files) {
			if (alreadyPlanned.has(file.path)) {
				continue;
			}
			const entry = settings.syncIndex[file.path];
			if (!entry?.yuqueLink) {
				continue;
			}
			const stale = entry.status === 'unchecked'
				|| entry.status === 'error'
				|| entry.status === 'remote-missing'
				|| !entry.remoteCheckedAt
				|| now - entry.remoteCheckedAt >= ttlMs;
			if (!stale) {
				continue;
			}

			const location = extractYuqueLocation(entry.yuqueLink);
			if (!location) {
				continue;
			}
			if (!entry.remoteUpdatedAt || entry.status === 'unchecked' || entry.status === 'error' || entry.status === 'remote-missing') {
				fallback.add(file.path);
				continue;
			}
			const items = groups.get(location.bookId) ?? [];
			items.push({ path: file.path, slug: location.slug });
			groups.set(location.bookId, items);
		}

		const groupEntries = [...groups.entries()];
		let groupCursor = 0;
		const groupConcurrency = Math.min(2, Math.max(1, settings.scanConcurrency));
		const groupWorker = async (): Promise<void> => {
			while (groupCursor < groupEntries.length) {
				const current = groupCursor;
				groupCursor += 1;
				const group = groupEntries[current];
				if (!group) {
					continue;
				}
				const [bookId, items] = group;
				try {
					const documents = await withRetry(() => this.client.listDocuments(bookId));
					const bySlug = new Map(documents.map((document) => [document.slug, document]));
					for (const item of items) {
						const entry = settings.syncIndex[item.path];
						const remote = bySlug.get(item.slug);
						if (!entry || !remote?.updatedAt) {
							fallback.add(item.path);
							continue;
						}
						if (remote.updatedAt === entry.remoteUpdatedAt) {
							entry.remoteCheckedAt = now;
							entry.lastCheckedAt = now;
							metadataHits += 1;
						} else {
							remoteRequired.add(item.path);
						}
					}
				} catch (error) {
					console.warn(`[Yuque Sync] 无法批量读取语雀知识库元数据，改用预算降级：${bookId}`, error);
					for (const item of items) {
						fallback.add(item.path);
					}
				}
			}
		};
		await Promise.all(Array.from({ length: Math.min(groupConcurrency, Math.max(1, groupEntries.length)) }, () => groupWorker()));

		const budget = Math.max(0, Math.floor(settings.remoteFallbackBudget || 0));
		const fallbackPaths = [...fallback]
			.filter((path) => !remoteRequired.has(path))
			.sort((left, right) => {
				const leftChecked = settings.syncIndex[left]?.remoteCheckedAt ?? 0;
				const rightChecked = settings.syncIndex[right]?.remoteCheckedAt ?? 0;
				return leftChecked - rightChecked;
			})
			.slice(0, budget);
		for (const path of fallbackPaths) {
			remoteRequired.add(path);
		}

		return { remoteRequired, metadataHits };
	}

	private async scanFile(file: TFile, mode: ScanMode, remoteRequired: boolean): Promise<ScanFileResult> {
		const settings = this.getSettings();
		const previous = settings.syncIndex[file.path];
		const now = Date.now();
		const snapshot = await this.readStableSnapshot(file);
		const { content } = snapshot;
		let frontmatter: Record<string, unknown>;
		try {
			frontmatter = readFrontmatter(content);
		} catch (error) {
			return {
				remoteRequest: false,
				entry: {
					path: file.path,
					mtime: snapshot.mtime,
					size: snapshot.size,
					status: 'yaml-error',
					lastCheckedAt: now,
					detail: describeError(error),
				},
			};
		}

		if (isYuqueSyncDisabled(frontmatter)) {
			return {
				remoteRequest: false,
				entry: {
					path: file.path,
					mtime: snapshot.mtime,
					size: snapshot.size,
					status: 'ignored',
					lastCheckedAt: now,
					detail: 'yuque_sync: false',
				},
			};
		}

		const yuqueLink = getStringProperty(frontmatter, 'yuque_link');
		if (!yuqueLink) {
			return {
				remoteRequest: false,
				entry: {
					path: file.path,
					mtime: snapshot.mtime,
					size: snapshot.size,
					status: 'unlinked',
					lastCheckedAt: now,
				},
			};
		}

		const location = extractYuqueLocation(yuqueLink);
		if (!location) {
			return {
				remoteRequest: false,
				entry: {
					path: file.path,
					mtime: snapshot.mtime,
					size: snapshot.size,
					status: 'invalid-link',
					yuqueLink,
					lastCheckedAt: now,
					detail: 'yuque_link 不是有效的语雀文档地址',
				},
			};
		}

		const localHash = await hashMarkdownBody(content);
		const previousForLink = previous?.yuqueLink === yuqueLink ? previous : undefined;
		if (mode === 'incremental' && !remoteRequired) {
			const localChanged = Boolean(previousForLink?.lastSyncedHash && localHash !== previousForLink.lastSyncedHash);
			return {
				remoteRequest: false,
				entry: {
					path: file.path,
					mtime: snapshot.mtime,
					size: snapshot.size,
					status: localChanged ? 'local-changed' : previousForLink?.status ?? 'unchecked',
					yuqueLink,
					localHash,
					remoteHash: previousForLink?.remoteHash,
					lastSyncedHash: previousForLink?.lastSyncedHash,
					remoteUpdatedAt: previousForLink?.remoteUpdatedAt,
					remoteCheckedAt: previousForLink?.remoteCheckedAt,
					lastCheckedAt: now,
					detail: localChanged
						? statusDetail('local-changed')
						: previousForLink?.detail ?? statusDetail('unchecked'),
				},
			};
		}

		try {
			const remote = await withRetry(() => this.client.getDocument(location.bookId, location.slug, 'low'));
			const remoteHash = await hashMarkdownBody(remote.content);
			const classification = classifyHashes(localHash, remoteHash, previousForLink?.lastSyncedHash);
			return {
				remoteRequest: true,
				entry: {
					path: file.path,
					mtime: snapshot.mtime,
					size: snapshot.size,
					status: classification.status,
					yuqueLink,
					localHash,
					remoteHash,
					lastSyncedHash: classification.baseline,
					remoteUpdatedAt: remote.updatedAt || undefined,
					remoteCheckedAt: now,
					lastCheckedAt: now,
					detail: statusDetail(classification.status),
				},
			};
		} catch (error) {
			const status: SyncStatus = getHttpStatus(error) === 404 ? 'remote-missing' : 'error';
			return {
				remoteRequest: true,
				entry: {
					path: file.path,
					mtime: snapshot.mtime,
					size: snapshot.size,
					status,
					yuqueLink,
					localHash,
					remoteHash: previousForLink?.remoteHash,
					lastSyncedHash: previousForLink?.lastSyncedHash,
					remoteUpdatedAt: previousForLink?.remoteUpdatedAt,
					remoteCheckedAt: now,
					lastCheckedAt: now,
					detail: describeError(error),
				},
			};
		}
	}


	private async readStableSnapshot(file: TFile): Promise<LocalSnapshot> {
		for (let attempt = 0; attempt < 3; attempt += 1) {
			const mtime = file.stat.mtime;
			const size = file.stat.size;
			const content = await this.app.vault.cachedRead(file);
			if (file.stat.mtime === mtime && file.stat.size === size) {
				return { content, mtime, size };
			}
		}
		throw new Error(`${file.path} 在检测期间持续变化，已保留为待重新检测`);
	}

	private reconcileDirtyPath(file: TFile, snapshot: LocalSnapshot): void {
		if (file.stat.mtime === snapshot.mtime && file.stat.size === snapshot.size) {
			this.dirtyPaths.delete(file.path);
		} else {
			this.dirtyPaths.add(file.path);
		}
	}

	private pruneMissingEntries(filesByPath: ReadonlyMap<string, TFile>): void {
		const settings = this.getSettings();
		for (const path of Object.keys(settings.syncIndex)) {
			if (!filesByPath.has(path)) {
				delete settings.syncIndex[path];
				this.dirtyPaths.delete(path);
			}
		}
	}

	private toScanResult(file: TFile): SyncScanResult {
		const entry = this.getSettings().syncIndex[file.path];
		if (!entry) {
			return {
				filePath: file.path,
				fileName: file.name,
				status: 'unchecked',
				detail: '尚未建立同步索引',
			};
		}
		return {
			filePath: file.path,
			fileName: file.name,
			status: entry.status,
			yuqueLink: entry.yuqueLink,
			detail: entry.detail,
		};
	}

	private async persistSessionProgress(
		remaining: ReadonlySet<string>,
		remoteRequired: ReadonlySet<string>,
	): Promise<void> {
		const session = this.getSettings().scanSession;
		if (!session) {
			return;
		}
		session.pendingPaths = [...remaining];
		session.remoteRequiredPaths = [...remaining].filter((path) => remoteRequired.has(path));
		session.completed = session.total - remaining.size;
		await this.persistNow();
	}

	private schedulePersist(): void {
		if (this.scanning || this.saveTimer !== null) {
			return;
		}
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			void this.persistNow();
		}, DIRTY_SAVE_DELAY_MS);
	}

	private async persistNow(): Promise<void> {
		this.getSettings().dirtyFiles = [...this.dirtyPaths];
		await this.saveSettings();
	}
}
