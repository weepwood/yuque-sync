import { App, ButtonComponent, Notice, Setting, TFile } from 'obsidian';
import type { ScanMode, ScanSummary, SyncScanResult, SyncStatus, YuqueSyncSettings } from './types';

const MAX_VISIBLE_ROWS = 500;
type StatusFilter = SyncStatus | 'all' | 'attention';

const STATUS_LABELS: Record<SyncStatus, string> = {
	synced: '已同步',
	'local-changed': '本地已修改',
	'remote-changed': '语雀已修改',
	conflict: '冲突',
	different: '内容不同',
	unchecked: '待远端校验',
	unlinked: '未关联',
	'invalid-link': '链接异常',
	'remote-missing': '远端不存在',
	'yaml-error': 'YAML 异常',
	ignored: '已忽略',
	error: '检测失败',
};

const STATUS_ORDER: Record<SyncStatus, number> = {
	conflict: 0,
	'local-changed': 1,
	'remote-changed': 2,
	different: 3,
	unlinked: 4,
	unchecked: 5,
	'invalid-link': 6,
	'remote-missing': 7,
	'yaml-error': 8,
	error: 9,
	ignored: 10,
	synced: 11,
};

const SUMMARY_STATUSES: SyncStatus[] = [
	'conflict', 'local-changed', 'remote-changed', 'different', 'unlinked', 'unchecked',
	'invalid-link', 'remote-missing', 'yaml-error', 'error', 'ignored', 'synced',
];

export interface SyncSettingsHost {
	pluginSettings: YuqueSyncSettings;
	runSettingsScan(mode: ScanMode): Promise<void>;
	runSettingsPushUnlinked(): Promise<void>;
	cancelSettingsScan(): boolean;
	isSettingsScanRunning(): boolean;
}

function formatDuration(milliseconds: number): string {
	if (milliseconds < 1000) return `${milliseconds} ms`;
	const seconds = milliseconds / 1000;
	if (seconds < 60) return `${seconds.toFixed(1)} 秒`;
	return `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`;
}

function isAttentionStatus(status: SyncStatus): boolean {
	return status !== 'synced' && status !== 'ignored';
}

export class SyncSettingsPanel {
	private statusFilter: StatusFilter = 'attention';
	private searchQuery = '';
	private searchTimer: number | null = null;
	private resultInfoEl!: HTMLElement;
	private tableBodyEl!: HTMLTableSectionElement;
	private emptyEl!: HTMLElement;
	private limitNoteEl!: HTMLElement;
	private filterSelectEl!: HTMLSelectElement;
	private summaryButtons = new Map<SyncStatus, HTMLButtonElement>();
	private actionButtons: ButtonComponent[] = [];
	private busyNoticeEl: HTMLElement | null = null;

	constructor(
		private readonly app: App,
		private readonly host: SyncSettingsHost,
		private readonly onRefresh: () => void,
	) {}

	render(parent: HTMLElement): void {
		new Setting(parent).setName('同步控制中心').setHeading();
		const results = this.getResults();
		const counts = this.getCounts(results);

		const intro = parent.createDiv({ cls: 'yuque-sync-settings-performance yuque-sync-control-intro' });
		const copy = intro.createDiv();
		copy.createEl('strong', { text: '同步状态与操作集中在这里' });
		copy.createEl('p', {
			text: '不再使用单独的同步状态弹窗。增量/完整检测、状态筛选、文档定位和批量推送都直接在设置页完成。状态来自持久化同步索引，重启 Obsidian 后仍可查看。',
		});
		const badges = intro.createDiv({ cls: 'yuque-sync-settings-presets' });
		this.createPreset(badges, '已索引', String(results.length));
		this.createPreset(badges, '需处理', String(results.filter((item) => isAttentionStatus(item.status)).length));
		this.createPreset(badges, '未关联', String(counts.get('unlinked') ?? 0));

		this.renderLastScan(parent, this.host.pluginSettings.lastScanSummary);
		this.renderActions(parent, counts);
		this.renderStatusSummary(parent, counts);
		this.renderFilters(parent, results, counts);
		this.renderTable(parent);
		this.renderRows(results);
	}

	dispose(): void {
		if (this.searchTimer !== null) {
			window.clearTimeout(this.searchTimer);
			this.searchTimer = null;
		}
	}

	private renderLastScan(parent: HTMLElement, summary: ScanSummary | null): void {
		if (!summary) {
			parent.createDiv({
				cls: 'yuque-sync-settings-notice',
				text: '尚无扫描摘要。可以先执行一次增量检测；首次运行会建立本地索引，并避免一次性下载所有远端正文。',
			});
			return;
		}
		const metrics = parent.createDiv({ cls: 'yuque-sync-scan-metrics yuque-sync-settings-scan-metrics' });
		this.createMetric(metrics, '文档总数', summary.total, '最近一次扫描范围');
		this.createMetric(metrics, '实际检测', summary.scanned, '读取或重新计算');
		this.createMetric(metrics, '缓存复用', summary.cached, '未重复处理');
		this.createMetric(metrics, '远端正文', summary.remoteBodyRequests, '实际 API 正文请求');
		this.createMetric(metrics, '元数据命中', summary.remoteMetadataHits, '无需下载正文');
		this.createMetric(metrics, '耗时', formatDuration(summary.durationMs), summary.mode === 'full' ? '完整检测' : '增量检测');
	}

	private renderActions(parent: HTMLElement, counts: Map<SyncStatus, number>): void {
		const actions = parent.createDiv({ cls: 'yuque-sync-button-container yuque-sync-scan-actions yuque-sync-settings-actions' });
		const secondary = actions.createDiv({ cls: 'yuque-sync-action-group' });
		const primary = actions.createDiv({ cls: 'yuque-sync-action-group' });

		const full = new ButtonComponent(secondary).setButtonText('完整检测');
		full.onClick(() => void this.runTask('正在完整检测同步状态', () => this.host.runSettingsScan('full')));
		this.actionButtons.push(full);

		if ((counts.get('unlinked') ?? 0) > 0) {
			const push = new ButtonComponent(secondary).setButtonText(`推送未关联 (${counts.get('unlinked') ?? 0})`);
			push.onClick(() => void this.runTask('正在批量推送未关联文档', () => this.host.runSettingsPushUnlinked()));
			this.actionButtons.push(push);
		}

		const cancel = new ButtonComponent(secondary).setButtonText('暂停当前检测');
		cancel.onClick(() => {
			new Notice(this.host.cancelSettingsScan()
				? '已请求暂停；当前请求完成后会保存进度'
				: '当前没有正在执行的同步检测');
		});

		const incremental = new ButtonComponent(primary).setButtonText('增量检测').setCta();
		incremental.onClick(() => void this.runTask('正在增量检测同步状态', () => this.host.runSettingsScan('incremental')));
		this.actionButtons.push(incremental);

		if (this.host.isSettingsScanRunning()) {
			this.showBusy(parent, '同步检测正在执行。可以继续停留在设置页，或点击“暂停当前检测”。');
		}
	}

	private renderStatusSummary(parent: HTMLElement, counts: Map<SyncStatus, number>): void {
		const section = parent.createDiv({ cls: 'yuque-sync-scan-section' });
		const heading = section.createDiv({ cls: 'yuque-sync-section-heading' });
		heading.createEl('h3', { text: '状态概览' });
		heading.createSpan({ text: '点击状态直接筛选', cls: 'yuque-sync-section-hint' });
		const summary = section.createDiv({ cls: 'yuque-sync-scan-summary' });
		for (const status of SUMMARY_STATUSES) {
			const count = counts.get(status) ?? 0;
			if (count === 0) continue;
			const item = summary.createEl('button', {
				cls: `yuque-sync-summary-item is-${status}`,
				attr: { type: 'button', title: `筛选：${STATUS_LABELS[status]}` },
			});
			item.createSpan({ text: STATUS_LABELS[status], cls: 'yuque-sync-summary-label' });
			item.createEl('strong', { text: String(count) });
			item.addEventListener('click', () => {
				this.statusFilter = status;
				this.filterSelectEl.value = status;
				this.renderRows(this.getResults());
			});
			this.summaryButtons.set(status, item);
		}
	}

	private renderFilters(parent: HTMLElement, results: SyncScanResult[], counts: Map<SyncStatus, number>): void {
		const section = parent.createDiv({ cls: 'yuque-sync-scan-section' });
		const heading = section.createDiv({ cls: 'yuque-sync-section-heading' });
		heading.createEl('h3', { text: '文档列表' });
		this.resultInfoEl = heading.createSpan({ cls: 'yuque-sync-section-hint' });
		const toolbar = section.createDiv({ cls: 'yuque-sync-filter-toolbar' });
		const search = toolbar.createEl('input', {
			cls: 'yuque-sync-search-input',
			attr: { type: 'search', placeholder: '搜索文档路径、详情或语雀链接…', 'aria-label': '搜索同步状态' },
		});
		search.addEventListener('input', () => {
			if (this.searchTimer !== null) window.clearTimeout(this.searchTimer);
			this.searchTimer = window.setTimeout(() => {
				this.searchTimer = null;
				this.searchQuery = search.value.trim().toLocaleLowerCase();
				this.renderRows(this.getResults());
			}, 120);
		});
		this.filterSelectEl = toolbar.createEl('select', { cls: 'yuque-sync-filter-select dropdown', attr: { 'aria-label': '按同步状态筛选' } });
		this.addFilterOption('all', `全部状态 (${results.length})`);
		this.addFilterOption('attention', `需要处理 (${results.filter((item) => isAttentionStatus(item.status)).length})`);
		for (const status of SUMMARY_STATUSES) {
			const count = counts.get(status) ?? 0;
			if (count > 0) this.addFilterOption(status, `${STATUS_LABELS[status]} (${count})`);
		}
		this.filterSelectEl.value = this.statusFilter;
		this.filterSelectEl.addEventListener('change', () => {
			this.statusFilter = this.filterSelectEl.value as StatusFilter;
			this.renderRows(this.getResults());
		});
		this.limitNoteEl = section.createDiv({ cls: 'yuque-sync-scan-limit-note' });
	}

	private renderTable(parent: HTMLElement): void {
		const tableWrap = parent.createDiv({ cls: 'yuque-sync-scan-table-wrap yuque-sync-settings-table-wrap' });
		const table = tableWrap.createEl('table', { cls: 'yuque-sync-scan-table' });
		const head = table.createEl('thead').createEl('tr');
		head.createEl('th', { text: '状态' });
		head.createEl('th', { text: '文档' });
		head.createEl('th', { text: '操作' });
		this.tableBodyEl = table.createEl('tbody');
		this.emptyEl = tableWrap.createDiv({ cls: 'yuque-sync-empty-state' });
		this.emptyEl.createEl('strong', { text: '没有匹配的文档' });
		this.emptyEl.createEl('span', { text: '尝试切换状态筛选或清除搜索关键词。' });
	}

	private renderRows(results: SyncScanResult[]): void {
		const filtered = this.getFilteredResults(results);
		const visible = filtered.slice(0, MAX_VISIBLE_ROWS);
		this.tableBodyEl.empty();
		this.emptyEl.toggleClass('is-visible', filtered.length === 0);
		this.resultInfoEl.setText(`匹配 ${filtered.length} / ${results.length}`);
		for (const [status, button] of this.summaryButtons) button.toggleClass('is-active', this.statusFilter === status);
		if (filtered.length > MAX_VISIBLE_ROWS) {
			this.limitNoteEl.setText(`命中 ${filtered.length} 条，仅渲染前 ${MAX_VISIBLE_ROWS} 条以保持设置页流畅。可继续缩小筛选或输入路径。`);
			this.limitNoteEl.addClass('is-visible');
		} else {
			this.limitNoteEl.setText('');
			this.limitNoteEl.removeClass('is-visible');
		}
		for (const result of visible) {
			const row = this.tableBodyEl.createEl('tr', { cls: `is-${result.status}` });
			row.createEl('td').createSpan({ text: STATUS_LABELS[result.status], cls: `yuque-sync-status-pill is-${result.status}` });
			const fileCell = row.createEl('td', { cls: 'yuque-sync-document-cell' });
			const fileButton = fileCell.createEl('button', { text: result.filePath, cls: 'yuque-sync-file-link', attr: { type: 'button', title: '在 Obsidian 中打开' } });
			fileButton.addEventListener('click', () => void this.openLocalFile(result.filePath));
			if (result.detail) fileCell.createDiv({ text: result.detail, cls: 'yuque-sync-result-detail' });
			const actionCell = row.createEl('td', { cls: 'yuque-sync-row-actions' });
			if (result.yuqueLink) {
				actionCell.createEl('a', { text: '打开语雀', cls: 'yuque-sync-external-link', attr: { href: result.yuqueLink, target: '_blank', rel: 'noopener noreferrer' } });
			} else {
				actionCell.createSpan({ text: '—', cls: 'yuque-sync-muted-action' });
			}
		}
	}

	private async runTask(label: string, operation: () => Promise<void>): Promise<void> {
		this.setActionsDisabled(true);
		this.showBusy(null, `${label}。完成后本页会自动刷新；检测任务可使用“暂停当前检测”。`);
		try {
			await operation();
		} finally {
			this.onRefresh();
		}
	}

	private showBusy(parent: HTMLElement | null, text: string): void {
		if (!this.busyNoticeEl && parent) this.busyNoticeEl = parent.createDiv({ cls: 'yuque-sync-settings-notice yuque-sync-control-busy' });
		if (!this.busyNoticeEl) {
			const actions = this.actionButtons[0]?.buttonEl.parentElement?.parentElement;
			if (actions?.parentElement) this.busyNoticeEl = actions.parentElement.createDiv({ cls: 'yuque-sync-settings-notice yuque-sync-control-busy' });
		}
		this.busyNoticeEl?.setText(text);
	}

	private setActionsDisabled(disabled: boolean): void {
		for (const button of this.actionButtons) button.setDisabled(disabled);
	}

	private getResults(): SyncScanResult[] {
		return Object.values(this.host.pluginSettings.syncIndex).map((entry) => ({
			filePath: entry.path,
			fileName: entry.path.split('/').pop() ?? entry.path,
			status: entry.status,
			yuqueLink: entry.yuqueLink,
			detail: entry.detail,
		}));
	}

	private getFilteredResults(results: SyncScanResult[]): SyncScanResult[] {
		return [...results].filter((result) => {
			if (this.statusFilter === 'attention' && !isAttentionStatus(result.status)) return false;
			if (this.statusFilter !== 'all' && this.statusFilter !== 'attention' && result.status !== this.statusFilter) return false;
			if (!this.searchQuery) return true;
			return [result.filePath, result.detail ?? '', result.yuqueLink ?? '', STATUS_LABELS[result.status]]
				.join('\n').toLocaleLowerCase().includes(this.searchQuery);
		}).sort((left, right) => STATUS_ORDER[left.status] - STATUS_ORDER[right.status] || left.filePath.localeCompare(right.filePath));
	}

	private getCounts(results: SyncScanResult[]): Map<SyncStatus, number> {
		const counts = new Map<SyncStatus, number>();
		for (const result of results) counts.set(result.status, (counts.get(result.status) ?? 0) + 1);
		return counts;
	}

	private addFilterOption(value: StatusFilter, text: string): void {
		this.filterSelectEl.createEl('option', { text, attr: { value } });
	}

	private createMetric(parent: HTMLElement, label: string, value: string | number, hint: string): void {
		const card = parent.createDiv({ cls: 'yuque-sync-metric-card' });
		card.createSpan({ text: label, cls: 'yuque-sync-metric-label' });
		card.createEl('strong', { text: String(value), cls: 'yuque-sync-metric-value' });
		card.createSpan({ text: hint, cls: 'yuque-sync-metric-hint' });
	}

	private createPreset(parent: HTMLElement, label: string, value: string): void {
		const item = parent.createDiv({ cls: 'yuque-sync-settings-preset' });
		item.createSpan({ text: label });
		item.createEl('strong', { text: value });
	}

	private async openLocalFile(path: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		await this.app.workspace.getLeaf(false).openFile(file);
	}
}
