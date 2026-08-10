export interface PendingCreate {
	yuqueLink: string;
	documentId: number;
	createdAt: number;
}

export type SyncStatus =
	| 'synced'
	| 'local-changed'
	| 'remote-changed'
	| 'conflict'
	| 'different'
	| 'unchecked'
	| 'unlinked'
	| 'invalid-link'
	| 'remote-missing'
	| 'yaml-error'
	| 'ignored'
	| 'error';

export type ScanMode = 'incremental' | 'full';

export interface SyncIndexEntry {
	path: string;
	mtime: number;
	size: number;
	status: SyncStatus;
	yuqueLink?: string;
	localHash?: string;
	remoteHash?: string;
	lastSyncedHash?: string;
	remoteUpdatedAt?: string;
	remoteCheckedAt?: number;
	lastCheckedAt: number;
	detail?: string;
}

export interface ScanSession {
	mode: ScanMode;
	total: number;
	completed: number;
	pendingPaths: string[];
	remoteRequiredPaths: string[];
	startedAt: number;
}

export interface YuqueSyncSettings {
	yuqueToken: string;
	defaultBookId: string;
	yuqueCookie: string;
	pendingCreates: Record<string, PendingCreate>;
	syncIndex: Record<string, SyncIndexEntry>;
	dirtyFiles: string[];
	scanSession: ScanSession | null;
	remoteCheckTtlHours: number;
	remoteFallbackBudget: number;
	scanConcurrency: number;
}

export const DEFAULT_SETTINGS: YuqueSyncSettings = {
	yuqueToken: '',
	defaultBookId: '',
	yuqueCookie: '',
	pendingCreates: {},
	syncIndex: {},
	dirtyFiles: [],
	scanSession: null,
	remoteCheckTtlHours: 24,
	remoteFallbackBudget: 200,
	scanConcurrency: 4,
};

export interface YuqueLocation {
	bookId: string;
	slug: string;
}

export interface YuqueDocument {
	title: string;
	content: string;
	updatedAt: string;
}

export interface RemoteYuqueDocumentMeta {
	slug: string;
	updatedAt: string;
}

export interface CreatedYuqueDocument {
	id: number;
	slug: string;
	updatedAt: string;
}

export interface ImageReference {
	kind: 'markdown' | 'wiki';
	source: string;
	path: string;
	pathStart: number;
	pathEnd: number;
	fullStart: number;
	fullEnd: number;
}

export interface SyncScanResult {
	filePath: string;
	fileName: string;
	status: SyncStatus;
	yuqueLink?: string;
	detail?: string;
}

export interface ScanSummary {
	mode: ScanMode;
	total: number;
	scanned: number;
	cached: number;
	resumed: boolean;
	canceled: boolean;
	durationMs: number;
	remoteMetadataHits: number;
	remoteBodyRequests: number;
}
