import { App, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { DEFAULT_SETTINGS, type YuqueSyncSettings } from './types';

export interface SettingsHost {
	pluginSettings: YuqueSyncSettings;
	saveSettings(): Promise<void>;
}

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;

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
		heroCopy.createDiv({ text: 'Yuque Sync', cls: 'yuque-sync-settings-title' });
		heroCopy.createEl('p', {
			text: '管理语雀连接、OpenAPI 主动限流和万级笔记的增量检测策略。设置会自动保存。',
		});
		const heroMeta = hero.createDiv({ cls: 'yuque-sync-settings-hero-meta' });
		heroMeta.createSpan({ text: 'Obsidian ↔ 语雀', cls: 'yuque-sync-settings-badge is-primary' });
		heroMeta.createSpan({ text: '增量同步', cls: 'yuque-sync-settings-badge' });
		heroMeta.createSpan({ text: '主动限流', cls: 'yuque-sync-settings-badge' });

		new Setting(containerEl)
			.setName('连接与存储')
			.setHeading();

		const connectionGroup = containerEl.createDiv({ cls: 'yuque-sync-settings-group' });
		connectionGroup.createDiv({
			cls: 'yuque-sync-settings-notice',
			text: 'Token、Cookie、增量同步索引、API 小时请求历史和未完成扫描进度会保存在当前 Obsidian 仓库的插件数据目录中。请勿共享 data.json。',
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

		this.renderRateLimitSettings(containerEl);

		new Setting(containerEl)
			.setName('大规模同步检测')
			.setHeading();

		const performanceIntro = containerEl.createDiv({ cls: 'yuque-sync-settings-performance' });
		const introCopy = performanceIntro.createDiv();
		introCopy.createEl('strong', { text: '15,000+ 笔记推荐配置' });
		introCopy.createEl('p', {
			text: '同步 worker 可以并发处理本地文件，但真正的语雀 OpenAPI 请求仍会经过全局限流器。通常无需为了限流而把 worker 并发降到 1。',
		});
		const presets = performanceIntro.createDiv({ cls: 'yuque-sync-settings-presets' });
		this.createPreset(presets, '远端周期', `${this.host.pluginSettings.remoteCheckTtlHours} 小时`);
		this.createPreset(presets, '降级预算', `${this.host.pluginSettings.remoteFallbackBudget} 篇`);
		this.createPreset(presets, 'worker 并发', String(this.host.pluginSettings.scanConcurrency));

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
			.setDesc('当语雀文档列表元数据不可用，或文档尚未建立远端基线时，每次增量检测最多逐篇校验多少篇正文。API 请求会自动排队，不会因为预算较大而瞬时发出。')
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
			.setName('同步检测 worker 并发数')
			.setDesc('控制本地检测与等待远端结果的 worker 数。API 实际发包速度由上方全局 OpenAPI 限流器单独控制。')
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

	private renderRateLimitSettings(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName('OpenAPI 请求限流')
			.setHeading();

		const now = Date.now();
		const history = this.host.pluginSettings.apiRequestHistory
			.filter((timestamp) => timestamp > now - HOUR_MS && timestamp <= now + MINUTE_MS);
		const secondUsed = history.filter((timestamp) => timestamp > now - SECOND_MS).length;
		const minuteUsed = history.filter((timestamp) => timestamp > now - MINUTE_MS).length;
		const hourUsed = history.length;

		const intro = containerEl.createDiv({ cls: 'yuque-sync-settings-performance' });
		const introCopy = intro.createDiv();
		introCopy.createEl('strong', { text: '全局主动限流已启用' });
		introCopy.createEl('p', {
			text: '所有语雀 OpenAPI 文档/目录请求统一排队，并同时满足秒、分钟、小时三个滑动窗口。收到 429 时会优先遵循 Retry-After，并暂停整个队列。默认值是插件保守值，不声明为语雀官方硬上限；请按官方 OpenAPI 页面当前额度调整。',
		});
		const presets = intro.createDiv({ cls: 'yuque-sync-settings-presets' });
		this.createPreset(presets, '最近 1 秒', `${secondUsed} / ${this.host.pluginSettings.apiRatePerSecond}`);
		this.createPreset(presets, '最近 1 分钟', `${minuteUsed} / ${this.host.pluginSettings.apiRatePerMinute}`);
		this.createPreset(presets, '最近 1 小时', `${hourUsed} / ${this.host.pluginSettings.apiRatePerHour}`);

		if (this.host.pluginSettings.apiPausedUntil > now) {
			containerEl.createDiv({
				cls: 'yuque-sync-settings-notice',
				text: `语雀 API 队列当前处于暂停状态，将在 ${new Date(this.host.pluginSettings.apiPausedUntil).toLocaleString()} 后恢复。`,
			});
		} else if (this.host.pluginSettings.apiLast429At) {
			containerEl.createDiv({
				cls: 'yuque-sync-settings-notice',
				text: `最近一次收到 HTTP 429：${new Date(this.host.pluginSettings.apiLast429At).toLocaleString()}。`,
			});
		}

		const group = containerEl.createDiv({ cls: 'yuque-sync-settings-group' });
		this.addPositiveIntegerSetting(
			group,
			'每秒请求上限',
			'发送任何新 OpenAPI 请求前都会检查最近 1 秒的请求数。插件默认 2 次/秒。',
			this.host.pluginSettings.apiRatePerSecond,
			(value) => { this.host.pluginSettings.apiRatePerSecond = value; },
		);
		this.addPositiveIntegerSetting(
			group,
			'每分钟请求上限',
			'与每秒限制同时生效。插件默认 50 次/分钟，用于为其他客户端或临时突发保留余量。',
			this.host.pluginSettings.apiRatePerMinute,
			(value) => { this.host.pluginSettings.apiRatePerMinute = value; },
		);
		this.addPositiveIntegerSetting(
			group,
			'每小时请求上限',
			'请求历史会跨 Obsidian 重启持久化。插件默认 4000 次/小时，低于公开资料常见的 5000 次/小时限制。',
			this.host.pluginSettings.apiRatePerHour,
			(value) => { this.host.pluginSettings.apiRatePerHour = value; },
		);

		new Setting(group)
			.setName('恢复插件保守默认值')
			.setDesc('恢复为 2 次/秒、50 次/分钟、4000 次/小时。')
			.addButton((button) => button
				.setButtonText('恢复默认')
				.onClick(() => {
					this.host.pluginSettings.apiRatePerSecond = DEFAULT_SETTINGS.apiRatePerSecond;
					this.host.pluginSettings.apiRatePerMinute = DEFAULT_SETTINGS.apiRatePerMinute;
					this.host.pluginSettings.apiRatePerHour = DEFAULT_SETTINGS.apiRatePerHour;
					void this.host.saveSettings().then(() => this.display());
				}));
	}

	private addPositiveIntegerSetting(
		parent: HTMLElement,
		name: string,
		description: string,
		currentValue: number,
		apply: (value: number) => void,
	): void {
		new Setting(parent)
			.setName(name)
			.setDesc(description)
			.addText((text) => {
				text.setValue(String(currentValue)).onChange((raw) => {
					const value = Math.floor(Number(raw));
					if (Number.isFinite(value) && value >= 1) {
						apply(value);
						this.scheduleSave();
					}
				});
				text.inputEl.type = 'number';
				text.inputEl.min = '1';
				text.inputEl.step = '1';
				text.inputEl.addClass('yuque-sync-wide-input');
			});
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
