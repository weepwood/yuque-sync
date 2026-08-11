import {
	type Editor,
	type MarkdownFileInfo,
	type MarkdownView,
	type Menu,
	Notice,
	Plugin,
	type TAbstractFile,
	TFile,
	normalizePath,
} from 'obsidian';
import { ConfirmModal } from './src/confirm-modal';
import {
	describeError,
	extractYuqueLocation,
	findImageReferences,
	formatFileTimestamp,
	getStringProperty,
	isYuqueSyncDisabled,
	readFrontmatter,
	replaceImageReferences,
	safeDecodeURIComponent,
	splitMarkdown,
} from './src/markdown-utils';
import { ManagedBookPool } from './src/managed-book-pool';
import { YuqueSyncSettingTab } from './src/settings-tab';
import { SyncEngine } from './src/sync-engine';
import {
	DEFAULT_SETTINGS,
	type ImageReference,
	type ScanMode,
	type SyncStatus,
	type YuqueSyncSettings,
} from './src/types';
import { YuqueClient } from './src/yuque-client';

const SUPPORTED_IMAGE_EXTENSIONS = new Set([
	'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'tiff', 'tif',
]);
const BACKUP_ROOT = '.yuque-sync/backups';
const LEGACY_BACKUP_PATTERN = /(?:^|\/)[^/]+\.backup-\d{8}-\d{6}(?:-\d+)?\.md$/;

interface CreateDocumentResult {
	yuqueLink: string;
	addedToToc: boolean;
	recovered: boolean;
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

export default class YuqueSyncPlugin extends Plugin {
	pluginSettings: YuqueSyncSettings = { ...DEFAULT_SETTINGS };

	private client!: YuqueClient;
	private statusBarItem!: HTMLElement;
	private statusTimer: number | null = null;
	private operationInProgress = false;
	private syncEngine!: SyncEngine;
	private bookPool!: ManagedBookPool;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.client = new YuqueClient(
			() => this.pluginSettings.yuqueToken,
			() => this.pluginSettings.yuqueCookie,
			() => this.pluginSettings,
			() => this.saveSettings(),
			(text) => this.setStatus(text),
		);
		this.bookPool = new ManagedBookPool(
			this.client,
			() => this.pluginSettings.yuqueToken,
			() => this.pluginSettings,
			() => this.saveSettings(),
			(text) => this.setStatus(text),
		);
		this.syncEngine = new SyncEngine(
			this.app,
			this.client,
			() => this.pluginSettings,
			() => this.saveSettings(),
			(file) => this.isManagedBackupFile(file),
			(text) => this.setStatus(text),
		);
		this.statusBarItem = this.addStatusBarItem();
		this.statusBarItem.addClass('yuque-sync-status');
		await this.cleanupResolvedPendingCreates();
		this.registerSyncTracking();

		this.addRibbonIcon('cloud-upload', '上传当前文档到语雀', () => {
			void this.runExclusive('正在上传文档', () => this.uploadActiveDocument());
		});
		this.addRibbonIcon('cloud-download', '从语雀下载当前文档', () => {
			void this.runExclusive('正在下载文档', () => this.downloadActiveDocument());
		});

		this.addCommand({
			id: 'upload-active-document',
			name: '上传当前文档到语雀',
			callback: () => {
				void this.runExclusive('正在上传文档', () => this.uploadActiveDocument());
			},
		});
		this.addCommand({
			id: 'download-active-document',
			name: '从语雀下载当前文档',
			callback: () => {
				void this.runExclusive('正在下载文档', () => this.downloadActiveDocument());
			},
		});
		this.addCommand({
			id: 'scan-incremental-documents',
			name: '增量检测文档同步状态',
			callback: () => {
				void this.runExclusive('正在增量检测同步状态', () => this.scanDocumentsAndShow('incremental'));
			},
		});
		this.addCommand({
			id: 'scan-all-documents',
			name: '完整检测所有文档同步状态',
			callback: () => {
				void this.runExclusive('正在完整检测同步状态', () => this.scanDocumentsAndShow('full'));
			},
		});
		this.addCommand({
			id: 'cancel-sync-scan',
			name: '暂停当前同步检测',
			callback: () => {
				new Notice(this.syncEngine.cancelScan()
					? '已请求暂停同步检测；当前请求完成后会保存进度'
					: '当前没有正在执行的同步检测');
			},
		});
		this.addCommand({
			id: 'push-unlinked-documents',
			name: '批量推送未关联文档到语雀',
			callback: () => {
				void this.runExclusive('正在批量推送文档', () => this.pushUnlinkedDocuments());
			},
		});
		this.addCommand({
			id: 'upload-all-images-in-active-document',
			name: '上传当前文档中的所有本地图片',
			callback: () => {
				const file = this.getActiveMarkdownFile();
				if (file) {
					void this.runExclusive('正在上传图片', () => this.uploadAllImagesInFile(file));
				}
			},
		});

		this.registerEditorImageMenu();
		this.registerFileImageMenu();
		this.addSettingTab(new YuqueSyncSettingTab(this.app, this));
	}

	onunload(): void {
		if (this.statusTimer !== null) {
			window.clearTimeout(this.statusTimer);
		}
		this.syncEngine?.dispose();
		this.client?.dispose();
		void this.syncEngine?.flush();
		void this.client?.flushRateLimiter();
	}

	async loadSettings(): Promise<void> {
		const saved = await this.loadData() as (Partial<YuqueSyncSettings> & { mySetting?: string }) | null;
		const migratedToken = saved?.yuqueToken || saved?.mySetting || '';
		this.pluginSettings = {
			...DEFAULT_SETTINGS,
			...saved,
			yuqueToken: migratedToken,
			managedBookOwnerLogin: saved?.managedBookOwnerLogin ?? '',
			managedBooks: saved?.managedBooks ?? [],
			pendingCreates: saved?.pendingCreates ?? {},
			syncIndex: saved?.syncIndex ?? {},
			dirtyFiles: saved?.dirtyFiles ?? [],
			scanSession: saved?.scanSession ?? null,
			lastScanSummary: saved?.lastScanSummary ?? null,
			remoteCheckTtlHours: saved?.remoteCheckTtlHours ?? DEFAULT_SETTINGS.remoteCheckTtlHours,
			remoteFallbackBudget: saved?.remoteFallbackBudget ?? DEFAULT_SETTINGS.remoteFallbackBudget,
			scanConcurrency: saved?.scanConcurrency ?? DEFAULT_SETTINGS.scanConcurrency,
			apiRatePerSecond: saved?.apiRatePerSecond ?? DEFAULT_SETTINGS.apiRatePerSecond,
			apiRatePerMinute: saved?.apiRatePerMinute ?? DEFAULT_SETTINGS.apiRatePerMinute,
			apiRatePerHour: saved?.apiRatePerHour ?? DEFAULT_SETTINGS.apiRatePerHour,
			apiRequestHistory: saved?.apiRequestHistory ?? [],
			apiPausedUntil: saved?.apiPausedUntil ?? 0,
			apiLast429At: saved?.apiLast429At ?? null,
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.pluginSettings);
	}

	async runSettingsScan(mode: ScanMode): Promise<void> {
		await this.runExclusive(
			mode === 'full' ? '正在完整检测同步状态' : '正在增量检测同步状态',
			() => this.scanDocumentsAndShow(mode),
		);
	}

	async runSettingsPushUnlinked(): Promise<void> {
		await this.runExclusive('正在批量推送文档', () => this.pushUnlinkedDocuments());
	}

	cancelSettingsScan(): boolean {
		return this.syncEngine.cancelScan();
	}

	isSettingsScanRunning(): boolean {
		return this.syncEngine.isScanning();
	}

	private async runExclusive(label: string, operation: () => Promise<void>): Promise<void> {
		if (this.operationInProgress) {
			new Notice('已有语雀同步任务正在执行，请等待当前任务完成');
			return;
		}

		this.operationInProgress = true;
		this.setStatus(`${label}…`);
		try {
			await operation();
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				new Notice('语雀同步任务已暂停');
				this.setStatus('同步任务已暂停', 3000);
				return;
			}
			console.error('[Yuque Sync] 操作失败', error);
			const message = describeError(error);
			new Notice(`语雀同步失败：${message}`);
			this.setStatus(`语雀同步失败：${message}`, 5000);
		} finally {
			this.operationInProgress = false;
			if (this.statusBarItem.textContent === `${label}…`) {
				this.setStatus('');
			}
		}
	}

	private async uploadActiveDocument(): Promise<void> {
		this.requireToken();
		const file = this.getActiveMarkdownFile();
		if (!file) {
			return;
		}

		const initialContent = await this.app.vault.read(file);
		const initialFrontmatter = readFrontmatter(initialContent);
		if (isYuqueSyncDisabled(initialFrontmatter)) {
			throw new Error('当前文件设置了 yuque_sync: false，已禁止语雀同步');
		}
		const yuqueLink = getStringProperty(initialFrontmatter, 'yuque_link');

		if (yuqueLink) {
			const location = extractYuqueLocation(yuqueLink);
			if (!location) {
				throw new Error('yuque_link 不是有效的语雀文档地址');
			}

			const firstCheck = await this.syncEngine.prepareUpload(file, yuqueLink);
			const riskyStatuses = new Set<SyncStatus>(['remote-changed', 'conflict', 'different']);
			const risky = riskyStatuses.has(firstCheck.status);
			const descriptions: Partial<Record<SyncStatus, string>> = {
				'remote-changed': '语雀正文已相对最近同步基线发生变化，而本地正文没有对应修改。强制上传会丢失语雀端修改。',
				conflict: '本地与语雀正文都已相对最近同步基线发生变化。强制上传会丢失语雀端修改。',
				different: '两端正文不同，但尚未建立可靠的最近同步基线，无法自动判断正确同步方向。',
				'local-changed': '仅检测到本地正文变化，可以上传到语雀。',
				synced: '当前本地与语雀正文一致。继续上传会刷新语雀标题与更新时间。',
			};
			const confirmed = await ConfirmModal.show(
				this.app,
				risky ? '检测到远端修改，仍要强制覆盖？' : '上传到语雀？',
				`${descriptions[firstCheck.status] ?? firstCheck.detail ?? '已完成上传前同步状态检查'}\n文档：${file.basename}`,
			);
			if (!confirmed) return;

			// 确认窗口停留期间远端可能再次变化，因此写入前再做一次短检查。
			const finalCheck = await this.syncEngine.prepareUpload(file, yuqueLink);
			if (finalCheck.remoteHash !== firstCheck.remoteHash) {
				throw new Error('确认期间语雀文档又发生了变化，为避免覆盖新内容，本次上传已取消');
			}
			const updatedAt = await this.client.updateDocument(
				location.bookId,
				location.slug,
				file.basename,
				splitMarkdown(finalCheck.content).body,
			);
			await this.syncEngine.recordSynchronized(file, yuqueLink, finalCheck.content, updatedAt);
			new Notice(risky ? '文档已在确认冲突风险后强制上传到语雀' : '文档已上传到语雀');
			this.setStatus('文档上传完成', 3000);
			return;
		}

		const confirmed = await ConfirmModal.show(
			this.app,
			'创建语雀文档？',
			'当前文件没有 yuque_link。插件会根据容量自动选择或创建私密语雀知识库，然后创建文档。',
		);
		if (!confirmed) {
			return;
		}

		const latestContent = await this.app.vault.read(file);
		if (getStringProperty(readFrontmatter(latestContent), 'yuque_link')) {
			throw new Error('确认期间当前文件已关联语雀文档，请重新执行上传');
		}
		const result = await this.createYuqueDocumentForFile(file);
		new Notice(result.recovered
			? '已恢复之前创建的语雀文档关联'
			: result.addedToToc
				? '文档已创建并加入语雀目录'
				: '文档已创建，但未能自动加入语雀目录');
		this.setStatus(result.recovered ? '文档关联已恢复' : '文档创建完成', 3000);
	}

	private async scanDocumentsAndShow(mode: ScanMode): Promise<void> {
		this.requireToken();
		if (mode === 'full') {
			const total = this.app.vault.getMarkdownFiles().filter((file) => !this.isManagedBackupFile(file)).length;
			const confirmed = await ConfirmModal.show(
				this.app,
				'执行完整同步检测？',
				`将深度校验 ${total} 篇 Markdown。完整检测会下载所有已关联语雀文档正文；任务支持暂停和断点继续。`,
			);
			if (!confirmed) return;
		}

		const report = await this.syncEngine.scan(mode);
		this.pluginSettings.lastScanSummary = report.summary;
		await this.saveSettings();

		const message = report.summary.canceled
			? `检测已暂停：本次处理 ${report.summary.scanned} 篇，进度已保存，可在设置 → Yuque Sync 查看`
			: `检测完成：实际处理 ${report.summary.scanned} 篇，复用缓存 ${report.summary.cached} 篇，远端正文请求 ${report.summary.remoteBodyRequests} 次；结果已更新到设置页`;
		new Notice(message);
		this.setStatus(message, 5000);
	}
	private async pushUnlinkedDocuments(): Promise<void> {
		this.requireToken();
		const { files, invalidCount } = await this.collectUnlinkedDocuments();
		if (files.length === 0) {
			new Notice(invalidCount
				? `没有可推送的未关联文档；另有 ${invalidCount} 个文档因读取或 YAML 异常被跳过`
				: '没有需要推送的未关联文档');
			return;
		}

		const confirmed = await ConfirmModal.show(
			this.app,
			'批量创建语雀文档？',
			`将创建 ${files.length} 篇未关联文档。插件会按容量自动选择或创建私密语雀知识库，任务串行执行，并为成功创建的文档写回 yuque_link。${invalidCount ? `\n另有 ${invalidCount} 篇文档因读取或 YAML 异常不会处理。` : ''}`,
		);
		if (!confirmed) {
			return;
		}

		let success = 0;
		let recovered = 0;
		let failed = 0;
		let skipped = 0;
		let tocFailed = 0;
		for (const [index, file] of files.entries()) {
			this.setStatus(`正在推送 ${index + 1}/${files.length}：${file.path}`);
			try {
				if (!(await this.isUnlinkedSyncableFile(file))) {
					skipped += 1;
					continue;
				}
				const result = await this.createYuqueDocumentForFile(file);
				success += 1;
				if (result.recovered) {
					recovered += 1;
				}
				if (!result.addedToToc) {
					tocFailed += 1;
				}
			} catch (error) {
				failed += 1;
				console.error(`[Yuque Sync] 批量创建失败：${file.path}`, error);
			}
		}

		const parts = [`批量推送完成：成功 ${success}`];
		if (recovered) {
			parts.push(`恢复关联 ${recovered}`);
		}
		if (skipped) {
			parts.push(`跳过 ${skipped}`);
		}
		if (failed) {
			parts.push(`失败 ${failed}`);
		}
		if (tocFailed) {
			parts.push(`目录加入失败 ${tocFailed}`);
		}
		const message = parts.join('，');
		new Notice(message);
		this.setStatus(message, 5000);
	}

	private async collectUnlinkedDocuments(): Promise<{ files: TFile[]; invalidCount: number }> {
		const files: TFile[] = [];
		let invalidCount = 0;
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (this.isManagedBackupFile(file)) {
				continue;
			}
			try {
				const content = await this.app.vault.cachedRead(file);
				const frontmatter = readFrontmatter(content);
				if (isYuqueSyncDisabled(frontmatter)) {
					continue;
				}
				if (!getStringProperty(frontmatter, 'yuque_link')) {
					files.push(file);
				}
			} catch (error) {
				invalidCount += 1;
				console.error(`[Yuque Sync] 扫描未关联文档失败：${file.path}`, error);
			}
		}
		return { files, invalidCount };
	}

	private async isUnlinkedSyncableFile(file: TFile): Promise<boolean> {
		if (this.isManagedBackupFile(file)) {
			return false;
		}
		const content = await this.app.vault.cachedRead(file);
		const frontmatter = readFrontmatter(content);
		return !isYuqueSyncDisabled(frontmatter) && !getStringProperty(frontmatter, 'yuque_link');
	}

	private async createYuqueDocumentForFile(file: TFile): Promise<CreateDocumentResult> {
		const content = await this.app.vault.read(file);
		const frontmatter = readFrontmatter(content);
		if (isYuqueSyncDisabled(frontmatter)) {
			throw new Error(`${file.path} 设置了 yuque_sync: false`);
		}
		if (getStringProperty(frontmatter, 'yuque_link')) {
			throw new Error(`${file.path} 已关联语雀文档`);
		}

		const recovered = await this.recoverPendingCreate(file);
		if (recovered) {
			return recovered;
		}

		let bookId = await this.bookPool.allocateBook();
		let created;
		try {
			created = await this.client.createDocument(
				bookId,
				file.basename,
				splitMarkdown(content).body,
			);
		} catch (error) {
			if (!(await this.bookPool.shouldRerouteAfterCreateFailure(bookId, error))) throw error;
			bookId = await this.bookPool.allocateBook();
			created = await this.client.createDocument(
				bookId,
				file.basename,
				splitMarkdown(content).body,
			);
		}
		const yuqueLink = `https://www.yuque.com/${bookId}/${created.slug}`;
		this.pluginSettings.pendingCreates[file.path] = {
			yuqueLink,
			documentId: created.id,
			createdAt: Date.now(),
		};
		await this.saveSettings();
		await this.bookPool.recordDocumentCreated(bookId);

		let latestContent: string;
		try {
			latestContent = await this.app.vault.read(file);
		} catch (error) {
			throw new Error(
				`语雀文档已创建，但无法验证本地文档，因此暂未写回链接。下次会尝试恢复关联：${yuqueLink}。原因：${describeError(error)}`,
			);
		}
		const latestFrontmatter = readFrontmatter(latestContent);
		if (getStringProperty(latestFrontmatter, 'yuque_link')) {
			throw new Error(`语雀文档已创建，但本地 yuque_link 在同步期间发生变化，因此未覆盖。新文档：${yuqueLink}`);
		}
		if (isYuqueSyncDisabled(latestFrontmatter)) {
			throw new Error(`语雀文档已创建，但本地文档在同步期间设置了 yuque_sync: false，因此未写回链接。新文档：${yuqueLink}`);
		}

		await this.app.fileManager.processFrontMatter(file, (metadata: Record<string, unknown>) => {
			metadata.yuque_link = yuqueLink;
			metadata.yuque_title = file.basename;
		});
		const addedToToc = await this.client.addDocumentToToc(bookId, created.id);
		delete this.pluginSettings.pendingCreates[file.path];
		await this.saveSettings();
		await this.syncEngine.recordSynchronized(file, yuqueLink, content, created.updatedAt);
		return { yuqueLink, addedToToc, recovered: false };
	}

	private async recoverPendingCreate(file: TFile): Promise<CreateDocumentResult | null> {
		const pending = this.pluginSettings.pendingCreates[file.path];
		if (!pending) {
			return null;
		}
		const location = extractYuqueLocation(pending.yuqueLink);
		if (!location) {
			delete this.pluginSettings.pendingCreates[file.path];
			await this.saveSettings();
			return null;
		}

		let remote: { title: string; content: string; updatedAt: string };
		try {
			remote = await this.client.getDocument(location.bookId, location.slug);
		} catch (error) {
			if (getHttpStatus(error) === 404) {
				delete this.pluginSettings.pendingCreates[file.path];
				await this.saveSettings();
				return null;
			}
			throw error;
		}

		await this.app.fileManager.processFrontMatter(file, (metadata: Record<string, unknown>) => {
			metadata.yuque_link = pending.yuqueLink;
			metadata.yuque_title = remote.title || file.basename;
			if (remote.updatedAt) {
				metadata.yuque_updated_at = remote.updatedAt;
			}
		});
		const addedToToc = await this.client.addDocumentToToc(location.bookId, pending.documentId);
		delete this.pluginSettings.pendingCreates[file.path];
		await this.saveSettings();
		await this.syncEngine.recordRemoteComparison(file, pending.yuqueLink, remote.content, remote.updatedAt);
		return { yuqueLink: pending.yuqueLink, addedToToc, recovered: true };
	}

	private async cleanupResolvedPendingCreates(): Promise<void> {
		let changed = false;
		for (const [filePath] of Object.entries(this.pluginSettings.pendingCreates)) {
			const abstractFile = this.app.vault.getAbstractFileByPath(filePath);
			if (!(abstractFile instanceof TFile)) {
				delete this.pluginSettings.pendingCreates[filePath];
				changed = true;
				continue;
			}
			try {
				const content = await this.app.vault.cachedRead(abstractFile);
				if (getStringProperty(readFrontmatter(content), 'yuque_link')) {
					delete this.pluginSettings.pendingCreates[filePath];
					changed = true;
				}
			} catch {
				// 保留 pending 状态，后续用户修复本地文件后仍可恢复。
			}
		}
		if (changed) {
			await this.saveSettings();
		}
	}

	private async downloadActiveDocument(): Promise<void> {
		this.requireToken();
		const file = this.getActiveMarkdownFile();
		if (!file) {
			return;
		}

		const localContent = await this.app.vault.read(file);
		const yuqueLink = getStringProperty(readFrontmatter(localContent), 'yuque_link');
		if (!yuqueLink) {
			throw new Error('当前文件缺少 yuque_link');
		}
		const location = extractYuqueLocation(yuqueLink);
		if (!location) {
			throw new Error('yuque_link 不是有效的语雀文档地址');
		}

		const document = await this.client.getDocument(location.bookId, location.slug);
		const remoteTimestamp = Date.parse(document.updatedAt);
		const localTimestamp = file.stat.mtime;
		const localLabel = new Date(localTimestamp).toLocaleString();
		const remoteLabel = Number.isNaN(remoteTimestamp)
			? '未知'
			: new Date(remoteTimestamp).toLocaleString();
		const relation = Number.isNaN(remoteTimestamp)
			? '无法比较修改时间'
			: remoteTimestamp > localTimestamp
				? '语雀版本较新'
				: remoteTimestamp < localTimestamp
					? '本地版本较新，请确认是否覆盖'
					: '两端修改时间相同';

		const confirmed = await ConfirmModal.show(
			this.app,
			'从语雀下载并覆盖本地文件？',
			`${relation}\n本地：${localLabel}\n语雀：${remoteLabel}\n覆盖前会备份到 ${BACKUP_ROOT}。`,
		);
		if (!confirmed) {
			return;
		}

		const confirmedLocalContent = await this.app.vault.read(file);
		if (confirmedLocalContent !== localContent) {
			throw new Error('下载确认期间本地文档已发生变化，请重新执行下载');
		}
		const backupPath = await this.createBackup(file, confirmedLocalContent);
		const contentBeforeReplace = await this.app.vault.read(file);
		if (contentBeforeReplace !== confirmedLocalContent) {
			throw new Error(`创建备份后本地文档又发生变化，已保留备份 ${backupPath}，未覆盖当前文件`);
		}

		const { frontmatterBlock } = splitMarkdown(confirmedLocalContent);
		const remoteBody = splitMarkdown(document.content).body;
		const nextContent = frontmatterBlock
			? `${frontmatterBlock}\n${remoteBody}`
			: remoteBody;
		await this.app.vault.modify(file, nextContent);
		await this.app.fileManager.processFrontMatter(file, (metadata: Record<string, unknown>) => {
			metadata.yuque_link = yuqueLink;
			metadata.yuque_title = document.title;
			if (document.updatedAt) {
				metadata.yuque_updated_at = document.updatedAt;
			}
		});
		await this.syncEngine.recordSynchronized(file, yuqueLink, nextContent, document.updatedAt);

		new Notice(`下载完成，原文件已备份到 ${backupPath}`);
		this.setStatus('文档下载完成', 3000);
	}

	private async createBackup(file: TFile, content: string): Promise<string> {
		const sourceDirectory = file.parent?.path ?? '';
		const backupDirectory = normalizePath(
			[BACKUP_ROOT, sourceDirectory].filter(Boolean).join('/'),
		);
		await this.ensureFolder(backupDirectory);

		const timestamp = formatFileTimestamp(new Date());
		let suffix = 0;
		let backupPath = '';
		do {
			const postfix = suffix === 0 ? '' : `-${suffix}`;
			backupPath = normalizePath(
				`${backupDirectory}/${file.basename}.backup-${timestamp}${postfix}.md`,
			);
			suffix += 1;
		} while (this.app.vault.getAbstractFileByPath(backupPath));

		await this.app.vault.create(backupPath, content);
		return backupPath;
	}

	private async ensureFolder(path: string): Promise<void> {
		let current = '';
		for (const segment of normalizePath(path).split('/').filter(Boolean)) {
			current = normalizePath([current, segment].filter(Boolean).join('/'));
			if (!this.app.vault.getAbstractFileByPath(current)) {
				await this.app.vault.createFolder(current);
			}
		}
	}

	private isManagedBackupFile(file: TFile): boolean {
		const path = normalizePath(file.path);
		return path === BACKUP_ROOT
			|| path.startsWith(`${BACKUP_ROOT}/`)
			|| LEGACY_BACKUP_PATTERN.test(path);
	}

	private registerSyncTracking(): void {
		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(this.app.vault.on('create', (file: TAbstractFile) => {
				if (file instanceof TFile && file.extension === 'md' && !this.isManagedBackupFile(file)) {
					this.syncEngine.markDirty(file.path);
				}
			}));
			this.registerEvent(this.app.vault.on('modify', (file: TAbstractFile) => {
				if (file instanceof TFile && file.extension === 'md' && !this.isManagedBackupFile(file)) {
					this.syncEngine.markDirty(file.path);
				}
			}));
			this.registerEvent(this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
				if (file instanceof TFile && file.extension === 'md' && !this.isManagedBackupFile(file)) {
					this.syncEngine.renamePath(oldPath, file.path);
				} else {
					this.syncEngine.removePath(oldPath);
				}
			}));
			this.registerEvent(this.app.vault.on('delete', (file: TAbstractFile) => {
				if (file instanceof TFile && file.extension === 'md') {
					this.syncEngine.removePath(file.path);
				}
			}));
		});
	}

	private registerEditorImageMenu(): void {
		this.registerEvent(this.app.workspace.on(
			'editor-menu',
			(menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
				const file = info.file;
				if (!file) {
					return;
				}
				const cursor = editor.getCursor();
				const line = editor.getLine(cursor.line);
				const reference = findImageReferences(line).find((item) =>
					cursor.ch >= item.fullStart && cursor.ch <= item.fullEnd,
				);
				if (!reference) {
					return;
				}

				menu.addItem((item) => item
					.setTitle('上传图片到语雀')
					.setIcon('upload')
					.onClick(() => {
						void this.runExclusive('正在上传图片', () =>
							this.uploadSingleImage(file, editor, cursor.line, reference));
					}));
			},
		));
	}

	private registerFileImageMenu(): void {
		this.registerEvent(this.app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile) => {
			if (!(file instanceof TFile) || file.extension !== 'md') {
				return;
			}
			menu.addItem((item) => item
				.setTitle('上传文档中的所有图片到语雀')
				.setIcon('images')
				.onClick(() => {
					void this.runExclusive('正在上传图片', () => this.uploadAllImagesInFile(file));
				}));
		}));
	}

	private async uploadSingleImage(
		markdownFile: TFile,
		editor: Editor,
		lineNumber: number,
		reference: ImageReference,
	): Promise<void> {
		this.requireCookie();
		const imageFile = this.resolveImageFile(reference.path, markdownFile);
		const imageUrl = await this.uploadImageFile(imageFile);

		const latestLine = editor.getLine(lineNumber);
		if (latestLine.slice(reference.fullStart, reference.fullEnd) !== reference.source) {
			throw new Error('上传期间图片引用已发生变化，请重新执行图片上传');
		}

		if (reference.kind === 'wiki') {
			editor.replaceRange(
				`![](${imageUrl})`,
				{ line: lineNumber, ch: reference.fullStart },
				{ line: lineNumber, ch: reference.fullEnd },
			);
		} else {
			editor.replaceRange(
				imageUrl,
				{ line: lineNumber, ch: reference.pathStart },
				{ line: lineNumber, ch: reference.pathEnd },
			);
		}
		new Notice('图片已上传到语雀');
		this.setStatus('图片上传完成', 3000);
	}

	private async uploadAllImagesInFile(file: TFile): Promise<void> {
		this.requireCookie();
		const confirmed = await ConfirmModal.show(
			this.app,
			'上传全部本地图片？',
			'上传完成后会将文档中的本地图片引用替换为语雀地址。',
		);
		if (!confirmed) {
			return;
		}

		const originalContent = await this.app.vault.read(file);
		const references = findImageReferences(originalContent);
		const imagePaths = [...new Set(references.map((reference) => reference.path))];
		if (imagePaths.length === 0) {
			new Notice('当前文档中没有可上传的本地图片');
			return;
		}

		const replacements = new Map<string, string>();
		let failed = 0;
		for (const [index, imagePath] of imagePaths.entries()) {
			this.setStatus(`正在上传图片 ${index + 1}/${imagePaths.length}：${imagePath}`);
			try {
				const imageFile = this.resolveImageFile(imagePath, file);
				const imageUrl = await this.uploadImageFile(imageFile);
				replacements.set(imagePath, imageUrl);
			} catch (error) {
				failed += 1;
				console.error(`[Yuque Sync] 图片上传失败：${imagePath}`, error);
			}
		}

		if (replacements.size === 0) {
			throw new Error('所有图片均上传失败');
		}
		const latestContent = await this.app.vault.read(file);
		if (latestContent !== originalContent) {
			throw new Error('上传期间文档内容已发生变化，为避免覆盖，本次未自动替换图片地址');
		}

		const nextContent = replaceImageReferences(originalContent, references, replacements);
		await this.app.vault.modify(file, nextContent);
		const message = `图片上传完成：成功 ${replacements.size} 张${failed ? `，失败 ${failed} 张` : ''}`;
		new Notice(message);
		this.setStatus(message, 5000);
	}

	private resolveImageFile(imagePath: string, markdownFile: TFile): TFile {
		const decodedPath = safeDecodeURIComponent(imagePath);
		const resolved = this.app.metadataCache.getFirstLinkpathDest(decodedPath, markdownFile.path);
		if (!resolved) {
			throw new Error(`无法解析图片路径：${imagePath}`);
		}
		if (!SUPPORTED_IMAGE_EXTENSIONS.has(resolved.extension.toLowerCase())) {
			throw new Error(`不支持的图片格式：${resolved.extension}`);
		}
		return resolved;
	}

	private async uploadImageFile(file: TFile): Promise<string> {
		const data = await this.app.vault.readBinary(file);
		return this.client.uploadImage(file.name, data);
	}

	private getActiveMarkdownFile(): TFile | null {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice('当前没有活动文件');
			return null;
		}
		if (file.extension !== 'md') {
			new Notice('当前文件不是 Markdown 文档');
			return null;
		}
		return file;
	}

	private requireToken(): void {
		if (!this.pluginSettings.yuqueToken.trim()) {
			throw new Error('请先在插件设置中配置 Yuque Token');
		}
	}

	private requireCookie(): void {
		if (!this.pluginSettings.yuqueCookie.trim()) {
			throw new Error('请先在插件设置中配置 Yuque Cookie');
		}
	}

	private setStatus(text: string, clearAfter = 0): void {
		if (this.statusTimer !== null) {
			window.clearTimeout(this.statusTimer);
			this.statusTimer = null;
		}
		this.statusBarItem.setText(text);
		this.statusBarItem.toggleClass('is-active', Boolean(text));
		if (clearAfter > 0) {
			this.statusTimer = window.setTimeout(() => {
				this.statusTimer = null;
				this.statusBarItem.setText('');
				this.statusBarItem.removeClass('is-active');
			}, clearAfter);
		}
	}
}
