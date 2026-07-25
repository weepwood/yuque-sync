import {
	Editor,
	MarkdownFileInfo,
	MarkdownView,
	Menu,
	Notice,
	Plugin,
	TAbstractFile,
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
	normalizeBookId,
	readFrontmatter,
	replaceImageReferences,
	safeDecodeURIComponent,
	splitMarkdown,
} from './src/markdown-utils';
import { YuqueSyncSettingTab } from './src/settings-tab';
import { DEFAULT_SETTINGS, type ImageReference, type YuqueSyncSettings } from './src/types';
import { YuqueClient } from './src/yuque-client';

const SUPPORTED_IMAGE_EXTENSIONS = new Set([
	'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'tiff', 'tif',
]);

export default class YuqueSyncPlugin extends Plugin {
	settings: YuqueSyncSettings = { ...DEFAULT_SETTINGS };

	private client!: YuqueClient;
	private statusBarItem!: HTMLElement;
	private statusTimer: number | null = null;
	private operationInProgress = false;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.client = new YuqueClient(
			() => this.settings.yuqueToken,
			() => this.settings.yuqueCookie,
		);
		this.statusBarItem = this.addStatusBarItem();
		this.statusBarItem.addClass('yuque-sync-status');

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
	}

	async loadSettings(): Promise<void> {
		const saved = await this.loadData() as (Partial<YuqueSyncSettings> & { mySetting?: string }) | null;
		const migratedToken = saved?.yuqueToken || saved?.mySetting || '';
		this.settings = {
			...DEFAULT_SETTINGS,
			...saved,
			yuqueToken: migratedToken,
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
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

		const localContent = await this.app.vault.read(file);
		const frontmatter = readFrontmatter(localContent);
		const yuqueLink = getStringProperty(frontmatter, 'yuque_link');
		const markdownBody = splitMarkdown(localContent).body;

		if (yuqueLink) {
			const location = extractYuqueLocation(yuqueLink);
			if (!location) {
				throw new Error('yuque_link 不是有效的语雀文档地址');
			}
			const confirmed = await ConfirmModal.show(
				this.app,
				'上传到语雀？',
				`将使用本地内容覆盖语雀文档：${file.basename}`,
			);
			if (!confirmed) {
				return;
			}
			await this.client.updateDocument(location.bookId, location.slug, file.basename, markdownBody);
			new Notice('文档已上传到语雀');
			this.setStatus('文档上传完成', 3000);
			return;
		}

		const bookId = normalizeBookId(this.settings.defaultBookId);
		if (!bookId) {
			throw new Error('请在设置中填写格式为 namespace/book 的默认知识库');
		}
		const confirmed = await ConfirmModal.show(
			this.app,
			'创建语雀文档？',
			`当前文件没有 yuque_link，将在 ${bookId} 中创建新文档。`,
		);
		if (!confirmed) {
			return;
		}

		const created = await this.client.createDocument(bookId, file.basename, markdownBody);
		const addedToToc = await this.client.addDocumentToToc(bookId, created.id);
		const newYuqueLink = `https://www.yuque.com/${bookId}/${created.slug}`;
		await this.app.fileManager.processFrontMatter(file, (metadata) => {
			metadata.yuque_link = newYuqueLink;
			metadata.yuque_title = file.basename;
		});

		new Notice(addedToToc
			? '文档已创建并加入语雀目录'
			: '文档已创建，但未能自动加入语雀目录');
		this.setStatus('文档创建完成', 3000);
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
			`${relation}\n本地：${localLabel}\n语雀：${remoteLabel}\n覆盖前会创建备份。`,
		);
		if (!confirmed) {
			return;
		}

		const backupPath = await this.createBackup(file, localContent);
		const { frontmatterBlock } = splitMarkdown(localContent);
		const remoteBody = splitMarkdown(document.content).body;
		const nextContent = frontmatterBlock
			? `${frontmatterBlock}\n${remoteBody}`
			: remoteBody;
		await this.app.vault.modify(file, nextContent);
		await this.app.fileManager.processFrontMatter(file, (metadata) => {
			metadata.yuque_link = yuqueLink;
			metadata.yuque_title = document.title;
			if (document.updatedAt) {
				metadata.yuque_updated_at = document.updatedAt;
			}
		});

		new Notice(`下载完成，原文件已备份到 ${backupPath}`);
		this.setStatus('文档下载完成', 3000);
	}

	private async createBackup(file: TFile, content: string): Promise<string> {
		const directory = file.parent?.path ?? '';
		const timestamp = formatFileTimestamp(new Date());
		let suffix = 0;
		let backupPath = '';

		do {
			const postfix = suffix === 0 ? '' : `-${suffix}`;
			backupPath = normalizePath(
				[directory, `${file.basename}.backup-${timestamp}${postfix}.md`].filter(Boolean).join('/'),
			);
			suffix += 1;
		} while (this.app.vault.getAbstractFileByPath(backupPath));

		await this.app.vault.create(backupPath, content);
		return backupPath;
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
		if (latestLine.slice(reference.pathStart, reference.pathEnd) !== reference.path) {
			throw new Error('上传期间当前行已发生变化，请重新执行图片上传');
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
		if (!this.settings.yuqueToken.trim()) {
			throw new Error('请先在插件设置中配置 Yuque Token');
		}
	}

	private requireCookie(): void {
		if (!this.settings.yuqueCookie.trim()) {
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
