import type { SyncStatus } from './types';

export interface SyncHashClassification {
	status: SyncStatus;
	baseline: string | undefined;
}

export function classifySyncHashes(
	localHash: string,
	remoteHash: string,
	baseline: string | undefined,
): SyncHashClassification {
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
