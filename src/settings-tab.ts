import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';
import type { YuqueSyncSettings } from './types';

export interface SettingsHost {
	settings: YuqueSyncSettings;
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
		containerEl.createEl('h2', { text: '语雀同步' });
		containerEl.createEl('p', {
			text: 'Token 和 Cookie 会保存在当前 Obsidian 仓库的插件数据目录中。请勿共享 data.json。',
			cls: 'setting-item-description',
		});

		new Setting(containerEl)
			.setName('Yuque Token')
			.setDesc('用于文档读取、创建和更新。可在语雀账户设置中生成。')
			.addText((text) => {
				text.setPlaceholder('请输入 Token')
					.setValue(this.host.settings.yuqueToken)
					.onChange((value) => {
						this.host.settings.yuqueToken = value.trim();
						this.scheduleSave();
					});
				text.inputEl.type = 'password';
				text.inputEl.autocomplete = 'off';
			});

		new Setting(containerEl)
			.setName('默认知识库')
			.setDesc('新建语雀文档时使用，格式为 namespace/book。')
			.addText((text) => text
				.setPlaceholder('weepwood/test')
				.setValue(this.host.settings.defaultBookId)
				.onChange((value) => {
					this.host.settings.defaultBookId = value.trim();
					this.scheduleSave();
				}));

		new Setting(containerEl)
			.setName('Yuque Cookie')
			.setDesc('仅用于语雀图片上传。该接口依赖网页 Cookie，可能随语雀接口调整而失效。')
			.addTextArea((text) => {
				text.setPlaceholder('cookie=...')
					.setValue(this.host.settings.yuqueCookie)
					.onChange((value) => {
						this.host.settings.yuqueCookie = value.trim();
						this.scheduleSave();
					});
				text.inputEl.addClass('yuque-sync-secret-input');
				text.inputEl.autocomplete = 'off';
			});
	}

	hide(): void {
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
			void this.host.saveSettings();
		}
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
