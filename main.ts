import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, requestUrl } from 'obsidian';

// Remember to rename these classes and interfaces!



interface MyPluginSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default'
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;

	// 语雀 Token
	yuqueToken: string = '8pWNuBSOTMYIQe7R5E8hVs8ngb0frjeJUEd4TmOO';

	

	async putDoc(book_id: string, slug: string, content: string) {

		const body = {
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
				'Origin': 'https://www.yuque.com',
				'Referer': 'https://www.yuque.com/',
				'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/}'
			},
			body: JSON.stringify(body)
		}).then((response) => { 
			console.log(response);
			new Notice('上传成功');
		}).catch((error) => { });

	}

	async onload() {
		await this.loadSettings();
		console.log('Slug Plugin loaded');

		// 添加一个状态栏图标
		const statusBarItem = this.addStatusBarItem();
		statusBarItem.setText('Get Slug');
		statusBarItem.addEventListener('click', async () => {
			new Notice('This is a notice weepwood!');
			await this.handleSlugAction();
		});

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('dice', 'Sample Plugin', (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			new Notice('This is a notice weepwood!');
		});
		// Perform additional things with the ribbon
		ribbonIconEl.addClass('my-plugin-ribbon-class');

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Status Bar Text');

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'open-sample-modal-simple',
			name: 'Open sample modal (simple)',
			callback: () => {
				new SampleModal(this.app).open();
			}
		});
		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: 'sample-editor-command',
			name: 'Sample editor command',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				console.log(editor.getSelection());
				editor.replaceSelection('Sample Editor Command');
			}
		});
		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: 'open-sample-modal-complex',
			name: 'Open sample modal (complex)',
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						new SampleModal(this.app).open();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	// 处理点击事件，获取 slug 并显示消息
	async handleSlugAction() {
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile) {
			const slug = await this.getSlugFromYaml(activeFile);
			const bookId = await this.getBookIdFromYaml(activeFile);
			const content =await this.getMarkdownContent(activeFile);
			if (bookId) {
				console.log(`Book ID found: ${bookId}`);
				this.displayMessage(`Book ID: ${bookId}`);
			} else {
				console.log('No book ID found in YAML frontmatter');
				this.displayMessage('No book ID found in YAML frontmatter');
			}

			if (slug) {
				console.log(`Slug found: ${slug}`);
				this.displayMessage(`Slug: ${slug}`);
			} else {
				console.log('No slug found in YAML frontmatter');
				this.displayMessage('No slug found in YAML frontmatter');
			}
			if (bookId && slug && content) {
				this.putDoc(bookId, slug, content);
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
		console.log(content);
		new Notice(content);
		return content;
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
			.setName('Setting #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));
	}
}
