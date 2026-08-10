import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';
import type { YuqueSyncSettings } from './types';

export interface SettingsHost {
	pluginSettings: YuqueSyncSettings;
	saveSettings(): Promise<void>;
}

export class YuqueSyncSettingTab extends PluginSettingTab {
	private saveTimer: number | null = null;

	constructor(app: App, private readonly host: Plugin & SettingsHost) {
		super(app, host);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('yuque-sync-settings');

		const hero = containerEl.createDiv({ cls: 'yuque-sync-settings-hero' });
		const heroCopy = hero.createDiv();
		heroCopy.createEl('h2', { text: 'Yuque Sync' });
		heroCopy.createEl('p', {
			text: '管理语雀连接、文档创建目标和万级笔记的增量检测策略。设置会自动保存。',
		});
		const heroMeta = hero.createDiv({ cls: 'yuque-sync-settings-hero-meta' });
		heroMeta.createSpan({ text: 'Obsidian ↔ 语雀', cls: 'yuque-sync-settings-badge is-primary' });
		heroMeta.createSpan({ text: '增量同步', cls: 'yuque-sync-settings-badge' });

		new Setting(containerEl)
			.setName('连接与存储')
			.setHeading();

		const connectionGroup = containerEl.createDiv({ cls: 'yuque-sync-settings-group' });
		connectionGroup.createDiv({
			cls: 'yuque-sync-settings-notice',
			text: 'Token、Cookie、增量同步索引和未完成扫描进度会保存在当前 Obsidian 仓库的插件数据目录中。请勿共享 data.json。',
		});

		new Setting(connectionGroup)
			.setName('Yuque Token')
			.setDesc('用于文档读取、创建和更新。可在语雀账户设置中生成。')
			.addText((text) => {
				text.setPlaceholder('请输入 Token')
					.setValue(this.host.pluginSettings.yuqueToken)
					.onChange((value) => {
						this.host.pluginSettings.yuqueToken = value.trim();
						this.scheduleSave();
					});
				text.inputEl.type = 'password';
				text.inputEl.autocomplete = 'off';
				text.inputEl.addClass('yuque-sync-wide-input');
			});

		new Setting(connectionGroup)
			.setName('默认知识库')
			.setDesc('新建语雀文档时使用，格式为 namespace/book。')
			.addText((text) => {
				text.setPlaceholder('weepwood/test')
					.setValue(this.host.pluginSettings.defaultBookId)
					.onChange((value) => {
						this.host.pluginSettings.defaultBookId = value.trim();
						this.scheduleSave();
					});
				text.inputEl.addClass('yuque-sync-wide-input');
			});

		new Setting(connectionGroup)
			.setName('Yuque Cookie')
			.setDesc('仅用于语雀图片上传。该接口依赖网页 Cookie，可能随语雀接口调整而失效。')
			.addTextArea((text) => {
				text.setPlaceholder('cookie=...')
					.setValue(this.host.pluginSettings.yuqueCookie)
					.onChange((value) => {
						this.host.pluginSettings.yuqueCookie = value.trim();
						this.scheduleSave();
					});
				text.inputEl.addClass('yuque-sync-secret-input');
				text.inputEl.autocomplete = 'off';
			});

		new Setting(containerEl)
			.setName('大规模同步检测')
			.setHeading();

		const performanceIntro = containerEl.createDiv({ cls: 'yuque-sync-settings-performance' });
		const introCopy = performanceIntro.createDiv();
		introCopy.createEl('strong', { text: '15,000+ 笔记推荐配置' });
		introCopy.createEl('p', {
			text: '默认参数优先控制远端请求量和限流风险。通常无需修改，只有语雀 API 明显限流或你希望加快首次远端校验时再调整。',
		});
		const presets = performanceIntro.createDiv({ cls: 'yuque-sync-settings-presets' });
		this.createPreset(presets, '远端周期', `${this.host.pluginSettings.remoteCheckTtlHours} 小时`);
		this.createPreset(presets, '降级预算', `${this.host.pluginSettings.remoteFallbackBudget} 篇`);
		this.createPreset(presets, '并发', String(this.host.pluginSettings.scanConcurrency));

		const performanceGroup = containerEl.createDiv({ cls: 'yuque-sync-settings-group' });
		new Setting(performanceGroup)
			.setName('远端元数据重新检查周期')
			.setDesc('本地未变化时，超过该时间才重新确认语雀更新时间。默认 24 小时。')
			.addDropdown((dropdown) => dropdown
				.addOptions({
					'1': '1 小时',
					'6': '6 小时',
					'24': '24 小时',
					'72': '3 天',
					'168': '7 天',
				})
				.setValue(String(this.host.pluginSettings.remoteCheckTtlHours))
				.onChange((value) => {
					this.host.pluginSettings.remoteCheckTtlHours = Number(value) || 24;
					this.scheduleSave();
				}));

		new Setting(performanceGroup)
			.setName('远端降级校验预算')
			.setDesc('当语雀文档列表元数据不可用，或文档尚未建立远端基线时，每次增量检测最多逐篇请求多少篇正文。')
			.addDropdown((dropdown) => dropdown
				.addOptions({
					'50': '50 篇 / 次',
					'100': '100 篇 / 次',
					'200': '200 篇 / 次',
					'500': '500 篇 / 次',
					'1000': '1000 篇 / 次',
				})
				.setValue(String(this.host.pluginSettings.remoteFallbackBudget))
				.onChange((value) => {
					this.host.pluginSettings.remoteFallbackBudget = Number(value) || 200;
					this.scheduleSave();
				}));

		new Setting(performanceGroup)
			.setName('同步检测并发数')
			.setDesc('只影响语雀网络请求和检测任务。默认 4；若遇到限流，插件会自动指数退避。')
			.addDropdown((dropdown) => dropdown
				.addOptions({
					'1': '1（最保守）',
					'2': '2',
					'4': '4（推荐）',
					'6': '6',
					'8': '8',
				})
				.setValue(String(this.host.pluginSettings.scanConcurrency))
				.onChange((value) => {
					this.host.pluginSettings.scanConcurrency = Number(value) || 4;
					this.scheduleSave();
				}));
	}

	hide(): void {
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
			void this.host.saveSettings();
		}
	}

	private createPreset(parent: HTMLElement, label: string, value: string): void {
		const item = parent.createDiv({ cls: 'yuque-sync-settings-preset' });
		item.createSpan({ text: label });
		item.createEl('strong', { text: value });
	}

	private scheduleSave(): void {
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
		}
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			void this.host.saveSettings();
		}, 400);
	}
}
