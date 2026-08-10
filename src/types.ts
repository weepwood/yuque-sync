export interface PendingCreate {
	yuqueLink: string;
	documentId: number;
	createdAt: number;
}

export interface YuqueSyncSettings {
	yuqueToken: string;
	defaultBookId: string;
	yuqueCookie: string;
	pendingCreates: Record<string, PendingCreate>;
}

export const DEFAULT_SETTINGS: YuqueSyncSettings = {
	yuqueToken: '',
	defaultBookId: '',
	yuqueCookie: '',
	pendingCreates: {},
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

export interface CreatedYuqueDocument {
	id: number;
	slug: string;
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

export type SyncStatus =
	| 'synced'
	| 'different'
	| 'unlinked'
	| 'invalid-link'
	| 'remote-missing'
	| 'yaml-error'
	| 'ignored'
	| 'error';

export interface SyncScanResult {
	filePath: string;
	fileName: string;
	status: SyncStatus;
	yuqueLink?: string;
	detail?: string;
}
