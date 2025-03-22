import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, requestUrl, ButtonComponent } from 'obsidian';
const FormData = require('form-data'); // 使用 form-data 模块
const path = require('path');

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

	yuqueToken: string = '';
	yuqueCookie: string = '';
	
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
		const ribbonIconEl2 = this.addRibbonIcon('cloud-download', 'Download Yuque', async (evt: MouseEvent) => {
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
		const ribbonIconEl3 = this.addRibbonIcon('image', 'Upload Image to Yuque', async (evt: MouseEvent) => {
			const activeFile = this.app.workspace.getActiveFile();
			if (activeFile) {
				// 获取文件内容
				const fileContent = await this.app.vault.read(activeFile);
				
				// 确认是否要上传图片
				const confirmed = await ConfirmModal.show(this.app, '确定要上传图片到语雀吗？');
				if (confirmed) {
					try {
						// 上传图片并替换链接
						const newContent = await this.uploadImagesToYuque(fileContent, activeFile);
						
						// 更新文件内容
						await this.app.vault.modify(activeFile, newContent);
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

	// 上传图片到语雀
	async uploadImageToYuque(imagePath: string, file: TFile): Promise<string> {
		// 获取图片的绝对路径
		const adapter = this.app.vault.adapter;
		const basePath = adapter.getBasePath();
		
		// 对图片路径进行URL解码，处理特殊字符如%等
		const decodedImagePath = decodeURIComponent(imagePath);
		
		const absoluteImagePath = decodedImagePath.startsWith('/') 
			? path.resolve(basePath, '.' + decodedImagePath) 
			: path.resolve(basePath, path.dirname(file.path), decodedImagePath);
		
		// 打印图片的绝对路径到控制台
		console.log('原始图片路径:', imagePath);
		console.log('解码后图片路径:', decodedImagePath);
		console.log('图片绝对路径:', absoluteImagePath);
		
		// 检查文件是否存在
		const file = app.vault.getAbstractFileByPath(imagePath);
		if (!(file instanceof TFile)) {
			new Notice("文件不存在或无效");
			return;
		}

		// 读取文件内容为 ArrayBuffer
		const buffer = await app.vault.readBinary(imagePath);
		// 将 Buffer 转换为 Blob
		const blob = new Blob([buffer], { type: 'application/octet-stream' });
		console.log('Blob created:', blob);

		// 构造 FormData
		const formData = new FormData();
		formData.append("file", blob, path.basename(imagePath));
		
		// 发送请求到语雀API
		try {
			const response = await requestUrl({
				url: 'https://www.yuque.com/api/upload/attach',
				method: 'POST',
				headers: {
					// 'Content-Type': `"multipart/form-data; boundary=--------------------------479796840006281570463111"`,
					'Cookie': this.yuqueCookie,
					'Referer': 'https://www.yuque.com',
					'Origin': 'https://www.yuque.com',
					'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0',
				},
				body: formData
			});
			
			// 处理返回结果
			if (response.status === 200) {
				const data = response.json;
				console.log("上传成功:", data);
				new Notice("上传成功: " + data.data.url);
				return data.data.url; // 返回上传后的 URL
			} else {
				console.error("上传失败:", response);
				new Notice("上传失败: " + response.text);
			}

		} catch (error) {
			console.error("请求错误:", error);
			new Notice("请求错误: " + error.message);
		}
	}
	
	// 上传文档中的所有图片到语雀并替换链接
	async uploadImagesToYuque(content: string, file: TFile): Promise<string> {
		// 匹配Markdown中的图片链接
		const imageRegex = /!\[([^\]]*)\]\(([^\)]+)\)/g;
		let match;
		let newContent = content;
		let replacements = [];
		
		// 收集所有需要替换的图片
		while ((match = imageRegex.exec(content)) !== null) {
			const [fullMatch, altText, imagePath] = match;
			
			// 跳过已经是网络图片的链接
			if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
				continue;
			}
			
			// 添加到替换列表
			replacements.push({
				fullMatch,
				altText,
				imagePath
			});
		}
		
		// 显示进度提示
		if (replacements.length > 0) {
			new Notice(`开始上传 ${replacements.length} 张图片...`);
		} else {
			new Notice('没有找到本地图片');
			return content;
		}
		
		// 逐个上传图片并替换链接
		for (const item of replacements) {
			try {
				// 上传图片到语雀
				const yuqueUrl = await this.uploadImageToYuque(item.imagePath, file);
				console.log('上传后的语雀链接:', yuqueUrl);
				
				// 替换原始链接
				const newImageMarkdown = `![${item.altText}](${yuqueUrl})`;
				newContent = newContent.replace(item.fullMatch, newImageMarkdown);
				
				new Notice(`已上传: ${item.imagePath}`);
			} catch (error) {
				console.error(`上传图片 ${item.imagePath} 失败:`, error);
				new Notice(`上传图片 ${item.imagePath} 失败: ${(error as Error).message}`);
			}
		}
		
		return newContent;
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
