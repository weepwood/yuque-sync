import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/sync-engine.ts';
let source = readFileSync(path, 'utf8');

source = source.replace('const INDEX_SAVE_INTERVAL = 100;', 'const INDEX_SAVE_INTERVAL = 500;');

source = source.replace(
	"\t\tconst previous = this.getSettings().syncIndex[file.path];\n\t\tconst classification = classifyHashes(localHash, remoteHash, previous?.lastSyncedHash);",
	"\t\tconst previous = this.getSettings().syncIndex[file.path];\n\t\tconst previousForLink = previous?.yuqueLink === yuqueLink ? previous : undefined;\n\t\tconst classification = classifyHashes(localHash, remoteHash, previousForLink?.lastSyncedHash);",
);

const scanOld = `\t\tconst localHash = await hashMarkdownBody(content);
\t\tif (mode === 'incremental' && !remoteRequired) {
\t\t\treturn {
\t\t\t\tremoteRequest: false,
\t\t\t\tentry: {
\t\t\t\t\tpath: file.path,
\t\t\t\t\tmtime: file.stat.mtime,
\t\t\t\t\tsize: file.stat.size,
\t\t\t\t\tstatus: previous?.lastSyncedHash && localHash !== previous.lastSyncedHash
\t\t\t\t\t\t? 'local-changed'
\t\t\t\t\t\t: previous?.status ?? 'unchecked',
\t\t\t\t\tyuqueLink,
\t\t\t\t\tlocalHash,
\t\t\t\t\tremoteHash: previous?.remoteHash,
\t\t\t\t\tlastSyncedHash: previous?.lastSyncedHash,
\t\t\t\t\tremoteUpdatedAt: previous?.remoteUpdatedAt,
\t\t\t\t\tremoteCheckedAt: previous?.remoteCheckedAt,
\t\t\t\t\tlastCheckedAt: now,
\t\t\t\t\tdetail: previous?.lastSyncedHash && localHash !== previous.lastSyncedHash
\t\t\t\t\t\t? statusDetail('local-changed')
\t\t\t\t\t\t: previous?.detail ?? statusDetail('unchecked'),
\t\t\t\t},
\t\t\t};
\t\t}

\t\ttry {
\t\t\tconst remote = await withRetry(() => this.client.getDocument(location.bookId, location.slug));
\t\t\tconst remoteHash = await hashMarkdownBody(remote.content);
\t\t\tconst classification = classifyHashes(localHash, remoteHash, previous?.lastSyncedHash);`;

const scanNew = `\t\tconst localHash = await hashMarkdownBody(content);
\t\tconst previousForLink = previous?.yuqueLink === yuqueLink ? previous : undefined;
\t\tif (mode === 'incremental' && !remoteRequired) {
\t\t\tconst localChanged = Boolean(previousForLink?.lastSyncedHash && localHash !== previousForLink.lastSyncedHash);
\t\t\treturn {
\t\t\t\tremoteRequest: false,
\t\t\t\tentry: {
\t\t\t\t\tpath: file.path,
\t\t\t\t\tmtime: file.stat.mtime,
\t\t\t\t\tsize: file.stat.size,
\t\t\t\t\tstatus: localChanged ? 'local-changed' : previousForLink?.status ?? 'unchecked',
\t\t\t\t\tyuqueLink,
\t\t\t\t\tlocalHash,
\t\t\t\t\tremoteHash: previousForLink?.remoteHash,
\t\t\t\t\tlastSyncedHash: previousForLink?.lastSyncedHash,
\t\t\t\t\tremoteUpdatedAt: previousForLink?.remoteUpdatedAt,
\t\t\t\t\tremoteCheckedAt: previousForLink?.remoteCheckedAt,
\t\t\t\t\tlastCheckedAt: now,
\t\t\t\t\tdetail: localChanged
\t\t\t\t\t\t? statusDetail('local-changed')
\t\t\t\t\t\t: previousForLink?.detail ?? statusDetail('unchecked'),
\t\t\t\t},
\t\t\t};
\t\t}

\t\ttry {
\t\t\tconst remote = await withRetry(() => this.client.getDocument(location.bookId, location.slug));
\t\t\tconst remoteHash = await hashMarkdownBody(remote.content);
\t\t\tconst classification = classifyHashes(localHash, remoteHash, previousForLink?.lastSyncedHash);`;

if (source.includes(scanOld)) {
	source = source.replace(scanOld, scanNew);
} else if (!source.includes("const previousForLink = previous?.yuqueLink === yuqueLink ? previous : undefined;")) {
	throw new Error('scanFile review patch target not found');
}

source = source.replace(
	"\t\t\t\t\tremoteHash: previous?.remoteHash,\n\t\t\t\t\tlastSyncedHash: previous?.lastSyncedHash,\n\t\t\t\t\tremoteUpdatedAt: previous?.remoteUpdatedAt,",
	"\t\t\t\t\tremoteHash: previousForLink?.remoteHash,\n\t\t\t\t\tlastSyncedHash: previousForLink?.lastSyncedHash,\n\t\t\t\t\tremoteUpdatedAt: previousForLink?.remoteUpdatedAt,",
);

writeFileSync(path, source);
