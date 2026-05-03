import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, requestUrl, ButtonComponent, Menu, Editor } from 'obsidian';

interface MyPluginSettings {
	yuqueToken: string;
	defaultBookId: string;
	yuqueCookie: string;
}

class ConfirmModal extends Modal {
	resolve!: (value: boolean) => void;
	reject!: (reason?: unknown) => void;

	constructor(app: App, private message: string, private html_message?: string) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h3', { text: this.message });

		// 添加一些文本内容
		contentEl.createEl('p', { text: this.html_message });

		// 创建按钮容器
		const buttonContainer = contentEl.createDiv({ cls: 'yuque-sync-button-container' });

		const confirmButton = new ButtonComponent(buttonContainer)
			.setButtonText('确认')
			.onClick(() => {
				this.resolve(true);
				this.close();
			});

		new ButtonComponent(buttonContainer)
			.setButtonText('取消')
			.onClick(() => {
				this.resolve(false);
				this.close();
			});

		// 添加内联样式以增加按钮之间的间距
		// buttonContainer.style.display = 'flex';
		// buttonContainer.style.justifyContent = 'space-between';
		buttonContainer.style.marginTop = '10px'; // 调整顶部间距
		confirmButton.buttonEl.style.marginRight = '20px'; // 调整按钮之间的间距
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}

	static async show(app: App, message: string, html_message?: string): Promise<boolean> {
		return new Promise((resolve, reject) => {
			const modal = new ConfirmModal(app, message, html_message);
			modal.resolve = resolve;
			modal.reject = reject;
			modal.open();
		});
	}
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	yuqueToken: '',
	defaultBookId: '',
	yuqueCookie: '',
}

export default class MyPlugin extends Plugin {
	settings!: MyPluginSettings;

	yuqueToken = '';

	// 从 URL 中提取 book_id 和 slug
	extractParts(url: string): { book_id: string; slug: string } | null {
		// 确保 URL 以 https://www.yuque.com/ 开头
		if (!url.startsWith("https://www.yuque.com/")) {
			return null;
		}

		// 去掉前缀部分
		const remaining = url.slice("https://www.yuque.com/".length);

		// 按 '/' 分割字符串
		const parts = remaining.split("/");

		// 提取 weepwood/test 和 string
		if (parts.length >= 2) {
			const book_id = `${parts[0]}/${parts[1]}`; // weepwood/test
			const slug = parts[2]; // string
			console.log(book_id, slug);
			return { book_id, slug };
		}

		return null;
	}

	async onload() {
		await this.loadSettings();

		console.log('Slug Plugin loaded');

		// 语雀 Token
		this.yuqueToken = this.settings.yuqueToken;

		// This creates an icon in the left ribbon.
		// 上传到语雀
		const ribbonIconEl = this.addRibbonIcon('cloud-upload', 'Upload Yuque', (_evt: MouseEvent) => {
			// Called when the user clicks the icon.
			this.handleAction();
		});

		// 从语雀下载
		this.addRibbonIcon('cloud-download', 'Download Yuque', async (_evt: MouseEvent) => {
			const activeFile = this.app.workspace.getActiveFile();
			if (activeFile) {
				const local_mtime = await this.getFileMtime(activeFile);

				const yuque_link = await this.getYuqueLinkFromYaml(activeFile);
				if (yuque_link) {
					const parts = this.extractParts(yuque_link);
					if (parts) {
						const { book_id, slug } = parts;
						const yuque_mtime = await this.getDocMtime(book_id, slug);
						console.log("本地端时间: " + local_mtime);
						console.log("语雀端时间: " + yuque_mtime);
						new Notice(`本地端时间: ${local_mtime}\n语雀端时间: ${yuque_mtime}`);
						const confirmed = await ConfirmModal.show(this.app, '确定要下载吗？', `本地端时间: ${local_mtime} \n 语雀端时间: ${yuque_mtime}`);
						if (confirmed) {
							const doc = await this.getDoc(book_id, slug);
							if (doc) {
								const { title, content } = doc;
								console.log(title, content);

								// 获取当前文件内容
								const fileContent = await this.app.vault.read(activeFile);
								const yaml = this.parseYamlFrontmatter(fileContent) as Record<string, string>;
								// 增加 yuque_title 属性
								yaml['yuque_title'] = title;

								// 保留 YAML 前置元数据并更新内容
								const newContent = `---\n${Object.entries(yaml).map(([key, value]) => `${key}: ${value}`).join('\n')}\n---\n${content}`;

								// 获取当前时间戳
								const local_mtime_stamp = new Date(local_mtime).getTime();

								// 复制当前文件 const copyFile
								await this.app.vault.create(`${activeFile.parent?.path}/${activeFile.basename}_${local_mtime_stamp}.md`, fileContent);

								// await this.app.vault.create(activeFile.path, newContent);

								// 更新当前文件
								await this.app.vault.modify(activeFile, newContent);

								new Notice('文件更新成功');
							} else {
								new Notice('下载失败');
							}
						} else {
							new Notice('操作已取消');
						}
					} else {
						new Notice('Invalid Yuque link');
					}
				} else {
					new Notice('No Yuque link found');
				}
			} else {
				new Notice('没有活动文件');
			}
		});

		// Perform additional things with the ribbon
		ribbonIconEl.addClass('my-plugin-ribbon-class');

		// 注册右键菜单 - 上传图片到语雀
		this.registerEvent(this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor, view) => {
			if (!this.settings.yuqueCookie) return;

			const cursor = editor.getCursor();
			const line = editor.getLine(cursor.line);

			// 查找当前行的图片语法 ![alt](path)
			const imageRegex = /!\[.*?\]\(([^)]+)\)/g;
			let match: RegExpExecArray | null;
			let imagePath: string | null = null;
			while ((match = imageRegex.exec(line)) !== null) {
				if (cursor.ch >= match.index && cursor.ch <= match.index + match[0].length) {
					imagePath = match[1];
					break;
				}
			}

			if (!imagePath) return;
			// 跳过已上线的图片
			if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) return;

			// 在异步回调外捕获当前位置信息
			const currentMatch = match;
			const parenPos = currentMatch ? currentMatch[0].indexOf('(') : 0;
			const matchLen = currentMatch ? currentMatch[0].length : 0;

			menu.addItem((item) => {
				item.setTitle('上传到语雀')
					.setIcon('upload')
					.onClick(async () => {
						const activeFile = view.file;
						if (!activeFile) return;

						// 解析图片路径
						const resolvedFile = this.app.metadataCache.getFirstLinkpathDest(decodeURIComponent(imagePath!), activeFile.path);
						if (!resolvedFile) {
							new Notice('无法解析图片路径');
							return;
						}

						const url = await this.uploadImageToYuque(resolvedFile);
						if (url) {
							// 替换编辑器中的图片路径
							const from = { line: cursor.line, ch: currentMatch!.index + parenPos + 1 };
							const to = { line: cursor.line, ch: currentMatch!.index + matchLen - 1 };
							editor.replaceRange(url, from, to);
							new Notice('图片已上传到语雀');
						}
					});
			});
		}));

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));
	}

	// 获取文件的更新时间
	// 修改 getFileMtime 方法，使其接收 TFile 而不是 Stat
	async getFileMtime(file: TFile): Promise<string> {
		const stat = await this.app.vault.adapter.stat(file.path);
		if (!stat) {
			console.error('无法获取文件状态:', file.path);
			return '未知';
		}
		const mtime = stat.mtime;
		const date = new Date(mtime);
		return date.toLocaleString(); // 转换为本地日期时间格式
	}

	// 上传到语雀
	async putDoc(book_id: string, slug: string, content: string, fileName: string) {
		console.log(this.yuqueToken);
		const body = {
			title: fileName,
			public: "0",
			format: "markdown",
			body: content
		};

		requestUrl({
			url: `https://www.yuque.com/api/v2/repos/${book_id}/docs/${slug}`,
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json',
				'X-Auth-Token': this.yuqueToken,
			},
			body: JSON.stringify(body)
		}).then((response) => {
			console.log(response);
			new Notice('上传成功');
		}).catch((error) => {
			console.error(error);
			new Notice('上传失败');
		});
	}

	// 在语雀创建新文档
	async createDoc(book_id: string, title: string, content: string): Promise<{ slug: string; id: number } | null> {
		try {
			const response = await requestUrl({
				url: `https://www.yuque.com/api/v2/repos/${book_id}/docs`,
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Auth-Token': this.yuqueToken,
				},
				body: JSON.stringify({
					title: title,
					public: "0",
					format: "markdown",
					body: content
				})
			});
			const data = response.json.data;
			new Notice('创建成功');
			return { slug: data.slug, id: data.id };
		} catch (error) {
			console.error(error);
			new Notice('创建文档失败');
			return null;
		}
	}

	// 将文档添加到知识库目录（TOC）
	async addDocToToc(book_id: string, doc_id: number): Promise<boolean> {
		try {
			await requestUrl({
				url: `https://www.yuque.com/api/v2/repos/${book_id}/toc`,
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
					'X-Auth-Token': this.yuqueToken,
				},
				body: JSON.stringify({
					action: "appendNode",
					action_mode: "sibling",
					type: "DOC",
					doc_ids: [doc_id]
				})
			});
			return true;
		} catch (error) {
			console.error('TOC 更新失败', error);
			return false;
		}
	}

	// 上传图片到语雀
	async uploadImageToYuque(file: TFile): Promise<string | null> {
		try {
			const fileData = await this.app.vault.readBinary(file);

			// 手动构建 multipart/form-data 请求体
			const boundary = 'YuqueSync' + Math.random().toString(36).substring(2);
			const headerStr = '--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + file.name + '"\r\nContent-Type: application/octet-stream\r\n\r\n';
			const footerStr = '\r\n--' + boundary + '--\r\n';

			const encoder = new TextEncoder();
			const headerBytes = encoder.encode(headerStr);
			const footerBytes = encoder.encode(footerStr);
			const bodyBuffer = new Uint8Array(headerBytes.length + fileData.byteLength + footerBytes.length);

			bodyBuffer.set(headerBytes, 0);
			bodyBuffer.set(new Uint8Array(fileData), headerBytes.length);
			bodyBuffer.set(footerBytes, headerBytes.length + fileData.byteLength);

			const response = await requestUrl({
				url: 'https://www.yuque.com/api/upload/attach',
				method: 'POST',
				headers: {
					'Referer': 'https://www.yuque.com',
					'Cookie': this.settings.yuqueCookie,
					'Content-Type': 'multipart/form-data; boundary=' + boundary,
				},
				body: bodyBuffer.buffer as ArrayBuffer
			});

			const result = response.json;
			if (result.data && result.data.url) {
				new Notice('图片上传成功');
				return result.data.url;
			}
			console.error('图片上传返回异常', result);
			new Notice('图片上传失败：接口返回异常');
			return null;
		} catch (error) {
			console.error(error);
			new Notice('图片上传失败');
			return null;
		}
	}


	// 获取语雀文档
	async getDoc(book_id: string, slug: string): Promise<{ title: string; content: string } | null> {
		try {
			const response = await requestUrl({
				url: `https://www.yuque.com/api/v2/repos/${book_id}/docs/${slug}`,
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
					'X-Auth-Token': this.yuqueToken,
				}
			});

			const data = response.json.data;
			console.log(data); // 修改为输出对象而不是字符串
			const title = data.title || '';
			const content = data.body || '';
			new Notice('下载成功');
			return { title, content };
		} catch (error) {
			console.error(error);
			new Notice('下载失败');
			return null; // 确保总是返回一个值
		}
	}

	// 获取语雀文档的更新时间
	async getDocMtime(book_id: string, slug: string): Promise<string> {
		try {
			const response = await requestUrl({
				url: `https://www.yuque.com/api/v2/repos/${book_id}/docs/${slug}`,
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
					'X-Auth-Token': this.yuqueToken,
				}
			});

			console.log(response);
			const date = new Date(response.json.data.updated_at);
			new Notice('获取成功');
			return date.toLocaleString();
		} catch (error) {
			console.error(error);
			new Notice('获取失败');
			return '未知';
		}
	}


	// 处理点击事件，获取 slug 并显示消息
	async handleAction() {
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile) {
			const yuque_link = await this.getYuqueLinkFromYaml(activeFile);
			const content = await this.getMarkdownContent(activeFile);
			const fileName = await this.getFileName(activeFile);

			console.log(yuque_link);

			if (yuque_link) {
				const parts = this.extractParts(yuque_link);
				if (parts) {
					const { book_id, slug } = parts;
					// 显示确认框
					const confirmed = await ConfirmModal.show(this.app, '确定要上传到语雀吗？');
					if (confirmed) {
						await this.putDoc(book_id, slug, content, fileName);
					}
				} else {
					this.displayMessage('Invalid Yuque link');
				}
			} else {
				// 没有 yuque_link，创建新文档
				if (!this.settings.defaultBookId) {
					new Notice('请先在设置中配置默认知识库');
					return;
				}
				const confirmed = await ConfirmModal.show(this.app, '语雀链接不存在，是否创建新文档？');
				if (confirmed) {
					const result = await this.createDoc(this.settings.defaultBookId, fileName, content);
					if (result) {
						// 添加到知识库目录（TOC）
						const tocOk = await this.addDocToToc(this.settings.defaultBookId, result.id);
						if (!tocOk) {
							new Notice('文档已创建，但添加到目录失败，请手动在语雀中调整目录');
						}

						const newYuqueLink = `https://www.yuque.com/${this.settings.defaultBookId}/${result.slug}`;
						// 更新文件 frontmatter
						const fileContent = await this.app.vault.read(activeFile);
						const yaml = this.parseYamlFrontmatter(fileContent) as Record<string, string>;
						yaml['yuque_link'] = newYuqueLink;
						const newContent = `---\n${Object.entries(yaml).map(([key, value]) => `${key}: ${value}`).join('\n')}\n---\n${content}`;
						await this.app.vault.modify(activeFile, newContent);
						new Notice('文档已创建并同步到语雀');
					}
				}
			}
		} else {
			this.displayMessage('No active file');
		}
	}

	// 显示消息
	displayMessage(message: string) {
		new Notice(message);
	}

	// 获取 MarkDown 内容 不包括 YAML 前置元数据
	async getMarkdownContent(file: TFile): Promise<string> {
		const fileContent = await this.app.vault.read(file);
		const yaml = this.parseYamlFrontmatter(fileContent);
		const content = fileContent.replace(/^---\s*([\s\S]*?)\s*---/, '');
		console.log("MarkDown: " + content);
		console.log("YAML: " + yaml);
		return content;
	}

	// 获取文件名称
	async getFileName(file: TFile): Promise<string> {
		return file.basename;
	}

	// 从文件的 YAML 前置元数据中获取 slug 属性
	async getSlugFromYaml(file: TFile): Promise<string | null> {
		const fileContent = await this.app.vault.read(file);
		const yaml = this.parseYamlFrontmatter(fileContent);
		return (yaml['slug'] as string) || null;
	}

	// 从文件的 YAML 前置元数据中获取 book_id 属性
	async getBookIdFromYaml(file: TFile): Promise<string | null> {
		const fileContent = await this.app.vault.read(file);
		const yaml = this.parseYamlFrontmatter(fileContent);
		return (yaml['book_id'] as string) || null;
	}

	// 从文件的 YAML 前置元数据中获取 yuque_link 属性
	async getYuqueLinkFromYaml(file: TFile): Promise<string | null> {
		const fileContent = await this.app.vault.read(file);
		const yaml = this.parseYamlFrontmatter(fileContent);
		return (yaml['yuque_link'] as string) || null;
	}

	// 解析 YAML 前置元数据
	parseYamlFrontmatter(content: string): Record<string, unknown> {
		const yamlRegex = /^---\s*([\s\S]*?)\s*---/;
		const match = content.match(yamlRegex);
		if (match) {
			const yamlString = match[1];
			return this.parseYaml(yamlString);
		}
		return {};
	}

	// 简单的 YAML 解析器
	parseYaml(yamlString: string): Record<string, unknown> {
		const lines = yamlString.split('\n');
		const result: Record<string, unknown> = {};
		let currentKey: string | null = null;

		for (const line of lines) {
			const trimmedLine = line.trim();
			if (!trimmedLine) continue;

			if (trimmedLine.includes(':')) {
				const [key, value] = trimmedLine.split(/:(.*)/).map(s => s.trim());
				currentKey = key;
				result[key] = value || true; // 如果没有值，默认为 true
			} else if (currentKey) {
				// 处理多行值
				result[currentKey] += '\n' + trimmedLine;
			}
		}

		return result;
	}

	onunload() {
	}

	async loadSettings() {
		const data = await this.loadData();
		// 从旧格式 mySetting 迁移
		if (data && data.mySetting && !data.yuqueToken) {
			data.yuqueToken = data.mySetting;
		}
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Yuque Token')
			.setDesc('https://www.yuque.com/settings/tokens')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.yuqueToken)
				.onChange(async (value) => {
					this.plugin.settings.yuqueToken = value;
					await this.plugin.saveSettings();
					this.plugin.yuqueToken = value; // 更新 yuqueToken
				})
				.inputEl.addEventListener('blur', () => {
					new Notice('设置已更新');
				}));

		new Setting(containerEl)
			.setName('默认知识库')
			.setDesc('语雀知识库 ID，例如 weepwood/test')
			.addText(text => text
				.setPlaceholder('weepwood/test')
				.setValue(this.plugin.settings.defaultBookId)
				.onChange(async (value) => {
					this.plugin.settings.defaultBookId = value;
					await this.plugin.saveSettings();
				})
				.inputEl.addEventListener('blur', () => {
					new Notice('设置已更新');
				}));

		new Setting(containerEl)
			.setName('Yuque Cookie')
			.setDesc('语雀 Cookie（上传图片需要），从浏览器开发者工具中获取')
			.addTextArea(text => text
				.setPlaceholder('cookie=...')
				.setValue(this.plugin.settings.yuqueCookie)
				.onChange(async (value) => {
					this.plugin.settings.yuqueCookie = value;
					await this.plugin.saveSettings();
				})
				.inputEl.addEventListener('blur', () => {
					new Notice('设置已更新');
				}));
	}
}
