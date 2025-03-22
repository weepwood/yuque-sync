import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, requestUrl, ButtonComponent } from 'obsidian';

// Remember to rename these classes and interfaces!


interface MyPluginSettings {
	mySetting: string;
	yuqueCookie: string;
}

class ConfirmModal extends Modal {
	resolve: (value: boolean) => void;
	reject: (reason?: any) => void;

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

		const cancelButton = new ButtonComponent(buttonContainer)
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
	mySetting: 'default',
	yuqueCookie: ''
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;

	yuqueToken = '';
	yuqueCookie = '';
	
	// 根据文件扩展名获取MIME类型
	getMimeType(filename: string): string {
		const ext = filename.split('.').pop()?.toLowerCase();
		const mimeTypes: {[key: string]: string} = {
			'jpg': 'image/jpeg',
			'jpeg': 'image/jpeg',
			'png': 'image/png',
			'gif': 'image/gif',
			'svg': 'image/svg+xml',
			'webp': 'image/webp',
			'bmp': 'image/bmp',
			'ico': 'image/x-icon',
			'tiff': 'image/tiff',
			'tif': 'image/tiff'
		};
		return ext && mimeTypes[ext] ? mimeTypes[ext] : 'application/octet-stream';
	}

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
		// 加载 CSS 文件

		this.addCommand({
			id: "get-images",
			name: "获取文档中的图片",
			callback: async () => {
				const file = this.app.workspace.getActiveFile();
				if (!file) {
					new Notice("未打开任何文件");
					return;
				}

				const content = await this.app.vault.read(file);
				const imageRegex = /!\[\[([^\]]+)\]\]|!\[.*?\]\((.*?)\)/g;
				let match;
				const images = [];

				while ((match = imageRegex.exec(content)) !== null) {
					const imgPath = match[1] || match[2]; // 获取匹配的图片路径
					// 排除 http 和 https 开头的图片
					if (imgPath.startsWith("http://") || imgPath.startsWith("https://")) {
						continue;
					}
					images.push(imgPath);
				}

				if (images.length > 0) {
					new Notice("图片列表：" + images.join(", "));
					console.log("文档中的图片：", images);
				} else {
					new Notice("文档中未找到图片");
				}
			},
		});

		console.log('Slug Plugin loaded');

		// 语雀 Token
		this.yuqueToken = this.settings.mySetting;
		// 语雀 Cookie
		this.yuqueCookie = this.settings.yuqueCookie;

		// 添加一个状态栏图标
		// const statusBarItem = this.addStatusBarItem();
		// statusBarItem.setText('Get Slug');
		// statusBarItem.addEventListener('click', async () => {
		// 	new Notice('This is a notice weepwood!');
		// 	await this.handleSlugAction();
		// });

		// This creates an icon in the left ribbon.
		// 上传到语雀
		const ribbonIconEl = this.addRibbonIcon('cloud-upload', 'Upload Yuque', (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			this.handleAction();
		});

		// 从语雀下载
		this.addRibbonIcon('cloud-download', 'Download Yuque', async (evt: MouseEvent) => {
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
								const yaml = this.parseYamlFrontmatter(fileContent);
								// 增加 yuque_title 属性
								yaml['yuque_title'] = title;

								// 保留 YAML 前置元数据并更新内容
								const newContent = `---\n${Object.entries(yaml).map(([key, value]) => `${key}: ${value}`).join('\n')}\n---\n${content}`;

								// 获取当前时间戳
								const local_mtime_stamp = new Date(local_mtime).getTime();

								// 复制当前文件
								const copyFile = await this.app.vault.create(`${activeFile.parent?.path}/${activeFile.basename}_${local_mtime_stamp}.md`, fileContent);

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
		

		// 图片上传到语雀
		this.addRibbonIcon('image', 'Upload Image to Yuque', async (evt: MouseEvent) => {
			const activeFile = this.app.workspace.getActiveFile();
			console.log(activeFile);
			if (activeFile) {
				// 获取文件内容
				await this.app.vault.read(activeFile);

				// 确认是否要上传图片
				const confirmed = await ConfirmModal.show(this.app, '确定要上传图片到语雀吗？');
				if (confirmed) {
					try {
						// 上传图片并替换链接
						await this.replaceLocalImages(activeFile);
						new Notice('图片上传成功并已更新链接');
					} catch (error) {
						console.error('图片上传失败:', error);
						new Notice('图片上传失败: ' + (error as Error).message);
					}
				}
			} else {
				new Notice('没有活动文件');
			}
		})

		// Perform additional things with the ribbon
		ribbonIconEl.addClass('my-plugin-ribbon-class');

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		// const statusBarItemEl = this.addStatusBarItem();
		// statusBarItemEl.setText('Status Bar Text');

		// This adds a simple command that can be triggered anywhere
		// this.addCommand({
		// 	id: 'open-sample-modal-simple',
		// 	name: 'Open sample modal (simple)',
		// 	callback: () => {
		// 		new SampleModal(this.app).open();
		// 	}
		// });

		// This adds an editor command that can perform some operation on the current editor instance
		// this.addCommand({
		// 	id: 'sample-editor-command',
		// 	name: 'Sample editor command',
		// 	editorCallback: (editor: Editor, view: MarkdownView) => {
		// 		console.log(editor.getSelection());
		// 		editor.replaceSelection('Sample Editor Command');
		// 	}
		// });

		// This adds a complex command that can check whether the current state of the app allows execution of the command
		// this.addCommand({
		// 	id: 'open-sample-modal-complex',
		// 	name: 'Open sample modal (complex)',
		// 	checkCallback: (checking: boolean) => {
		// 		// Conditions to check
		// 		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		// 		if (markdownView) {
		// 			// If checking is true, we're simply "checking" if the command can be run.
		// 			// If checking is false, then we want to actually perform the operation.
		// 			if (!checking) {
		// 				new SampleModal(this.app).open();
		// 			}

		// 			// This command will only show up in Command Palette when the check function returns true
		// 			return true;
		// 		}
		// 	}
		// });

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		// this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
		// 	console.log('click', evt);
		// });

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		// this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
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

	async uploadImageToYuque2(file: any) {
		const apiUrl = "https://www.yuque.com/api/upload/attach";
		// const formData = new FormData();
		const arrayBuffer = await this.app.vault.readBinary(file);
		// const blob = new Blob([arrayBuffer], { type:"image/png"}); // 这里假设是 PNG 图片
		// formData.append("file", blob, file.name);  // 确保提供文件名

		// 使用getMimeType函数判断文件类型
		const fileType = this.getMimeType(file.name);
		console.log("文件名：" + file.name);
		console.log("文件类型：" + fileType);

		const boundary = "----WebKitFormBoundary" + Math.random().toString(16);
		let body = `--${boundary}\r\n`;
		body += `Content-Disposition: form-data; name="file"; filename="${file.name}"\r\n`;
		body += `Content-Type: ${fileType}\r\n\r\n`;

		const bodyEnd = `\r\n--${boundary}--\r\n`;
		
		// 合并文本和文件数据
		const encoder = new TextEncoder();
		const bodyBuffer = new Uint8Array([
			...encoder.encode(body),
			...new Uint8Array(arrayBuffer),
			...encoder.encode(bodyEnd),
		]);


		const response = await requestUrl({
			url: apiUrl,
			method: "POST",
			headers: {
				"Content-Type": `multipart/form-data; boundary=${boundary}`,
				'Cookie': 'receive-cookie-deprecation=1; lang=zh-cn; _uab_collina=173112094991807440099133; receive-cookie-deprecation=1; _tea_utm_cache_20001731={%22utm_source%22:%22ld246.com%22}; _yuque_session=Wp4jcnzLxQz_Ipaz8d5WOKiEcGqnYOd0jF_u6u4Ocu8IbOJ0qJ4YRl3lu-nfgxo0e4_9yc2DrIjUH2EMqDFiTA==; tfstk=gYLjN6tOPdLzf8wkixhPNHKJV_b6cdgUh519tCU46ZQYBRddUSrV0sz6Vdpl0tpNuRg6FZIM0OWVCNOMdbkE82RDiNbqLvuU08FeYwVYWieNw7CC5shckkM9iNbtU7ztY2ODpoOpgFQtNaC19-QTDih7e6W8k1UA68h5sTQO6PUTyaCOtsBTDdd-N1XRBNQt6hNC1m6DGjp2vdbIpodCFPU9P_HGBIwgXTxRGa6pME9kUUaOc9dAFPkBIWWRe6T-I-WMPQLAsL3zlNOR1p_vVYUXCIKHI6pxP-CXDBOFVFDL5_xJng5XVfERHBB5kTTisPXv0CLNfEHL_tLD3UsHS-MPQHRykg9KUz9GfnKdkFMIygSg89_qIlN5xP15LbG7jljKnSCTr5HXSiClGglSN-KGD_f5ZbG7jljAZ_zsNbwvj; aliyungf_tc=c9abd5c69e5bb19b4ecefca42c83198bfb1242af36e0e872b1cd8874c084c201; yuque_ctoken=DxBOK1gOwW0Bcl1HkO4NPTBL; current_theme=default; acw_tc=ac11000117426484784368803e14fcae9bc33f9b16246248e7f78b5f51b6d6',
				'Referer': 'https://www.yuque.com',
				'Origin': 'https://www.yuque.com',
				'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0',
			},
			body: bodyBuffer.buffer,
		});
		console.log(response);
		if (response.status === 200) {
			const result = await response.json;
			console.log(result);
			new Notice('上传成功');
			return result.data.url; // 获取返回的 URL
		} else {
			console.error("上传失败:", response.status);
			console.error("上传失败:", response.text);
			return null; // 上传失败时返回 null
		}
	}

	// 获取文件的本地图片列表
	async getLocalImages(file: TFile) {
		// const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice("未打开任何文件");
			return;
		}

		const content = await this.app.vault.read(file);
		const imageRegex = /!\[\[([^\]]+)\]\]|!\[.*?\]\((.*?)\)/g;
		let match;
		const images = [];

		while ((match = imageRegex.exec(content)) !== null) {
			const imgPath = match[1] || match[2]; // 获取匹配的图片路径
			// 排除 http 和 https 开头的图片
			if (imgPath.startsWith("http://") || imgPath.startsWith("https://")) {
				continue;
			}
			images.push(imgPath);
		}

		if (images.length > 0) {
			new Notice("图片列表：" + images.join(", "));
			console.log("文档中的图片：", images);
		} else {
			new Notice("文档中未找到图片");
		}
	}

	async replaceLocalImages(activeFile: TFile) {
		let content = await this.app.vault.read(activeFile);
		console.log("Content:", content);

		const wikiImageRegex = /!\[\[([^\]]+)\]\]/g;
		const markdownImageRegex = /!\[.*?\]\(([^)]+)\)/g;

		let match;
		const localImages: string[] = [];

		// TODO 增加进度显示

		while ((match = wikiImageRegex.exec(content)) !== null) {
			const fileName = match[1];
			const file = this.app.metadataCache.getFirstLinkpathDest(fileName, activeFile.path);

			if (file) {
				localImages.push(fileName);
				try {
					console.log(`Uploaded image: ${fileName}`);
					const imageUrl = await this.uploadImageToYuque2(file);
					if (imageUrl) {
						content = content.replace(match[0], `![${fileName}](${imageUrl})`);
					} else {
						console.error(`Upload failed for: ${fileName}`);
					}
				} catch (error) {
					console.error(`上传错误 ${fileName}:`, error);
				}
			} else {
				console.warn(`File not found: ${fileName}`);
			}
		}

		while ((match = markdownImageRegex.exec(content)) !== null) {
			const imagePath = match[1];

			if (imagePath.startsWith("http")) continue;

			const file = this.app.metadataCache.getFirstLinkpathDest(imagePath, activeFile.path);

			if (file) {
				localImages.push(imagePath);
				try {
					console.log(`Uploaded image: ${file}`);
					const imageUrl = await this.uploadImageToYuque2(file);
					if (imageUrl) {
						content = content.replace(match[0], `![${imagePath}](${imageUrl})`);
					} else {
						console.error(`Upload failed for: ${imagePath}`);
					}
				} catch (error) {
					console.error(`Error uploading ${imagePath}:`, error);
				}
			} else {
				console.warn(`File not found: ${imagePath}`);
			}
		}

		console.log("Extracted Local Images:", localImages);

		// 仅当至少有一张图片上传成功时才修改文件
		if (localImages.length > 0) {
			await this.app.vault.modify(activeFile, content);
			console.log("Images replaced successfully");
		} else {
			console.log("No images uploaded successfully, file not modified.");
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
						this.putDoc(book_id, slug, content, fileName);
					}

					// this.putDoc(book_id, slug, content, fileName);
				} else {
					this.displayMessage('Invalid Yuque link');
				}
			} else {
				this.displayMessage('No Yuque link found');
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
		console.log("MarkDown: "+content);
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
		return yaml['slug'] || null;
	}

	// 从文件的 YAML 前置元数据中获取 book_id 属性
	async getBookIdFromYaml(file: TFile): Promise<string | null> {
		const fileContent = await this.app.vault.read(file);
		const yaml = this.parseYamlFrontmatter(fileContent);
		return yaml['book_id'] || null;
	}

	// 从文件的 YAML 前置元数据中获取 yuque_link 属性
	async getYuqueLinkFromYaml(file: TFile): Promise<string | null> {
		const fileContent = await this.app.vault.read(file);
		const yaml = this.parseYamlFrontmatter(fileContent);
		return yaml['yuque_link'] || null;
	}

	// 解析 YAML 前置元数据
	parseYamlFrontmatter(content: string): Record<string, any> {
		const yamlRegex = /^---\s*([\s\S]*?)\s*---/;
		const match = content.match(yamlRegex);
		if (match) {
			const yamlString = match[1];
			return this.parseYaml(yamlString);
		}
		return {};
	}

	// 简单的 YAML 解析器
	parseYaml(yamlString: string): Record<string, any> {
		const lines = yamlString.split('\n');
		const result: Record<string, any> = {};
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
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
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
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
					this.plugin.yuqueToken = value; // 更新 yuqueToken
				})
				.inputEl.addEventListener('blur', () => {
					new Notice('设置已更新');
				}));
		
		// 设置语雀 Cookie
		new Setting(containerEl).setName('yuque Cookie')
			.setDesc('yuque Cookie')
			.addText(text => text
				.setPlaceholder('Enter your cookie')
				.setValue(this.plugin.settings.yuqueCookie)
				.onChange(async (value) => {
					this.plugin.settings.yuqueCookie = value;
					await this.plugin.saveSettings();
					this.plugin.yuqueCookie = value; //更新 yuqueCookie
				})
			)
	}
}
