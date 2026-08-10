import { App, ButtonComponent, Modal, TFile } from 'obsidian';
import type { ScanMode, ScanSummary, SyncScanResult, SyncStatus } from './types';

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
	'conflict',
	'local-changed',
	'remote-changed',
	'different',
	'unlinked',
	'unchecked',
	'invalid-link',
	'remote-missing',
	'yaml-error',
	'error',
	'ignored',
	'synced',
];

function formatDuration(milliseconds: number): string {
	if (milliseconds < 1000) {
		return `${milliseconds} ms`;
	}
	const seconds = milliseconds / 1000;
	if (seconds < 60) {
		return `${seconds.toFixed(1)} 秒`;
	}
	return `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`;
}

function isAttentionStatus(status: SyncStatus): boolean {
	return status !== 'synced' && status !== 'ignored';
}

export class SyncStatusModal extends Modal {
	private statusFilter: StatusFilter = 'attention';
	private searchQuery = '';
	private resultInfoEl!: HTMLElement;
	private tableBodyEl!: HTMLTableSectionElement;
	private emptyEl!: HTMLElement;
	private limitNoteEl!: HTMLElement;
	private filterSelectEl!: HTMLSelectElement;
	private summaryButtons = new Map<SyncStatus, HTMLButtonElement>();
	private searchTimer: number | null = null;

	constructor(
		app: App,
		private readonly results: SyncScanResult[],
		private readonly summary: ScanSummary,
		private readonly onScan: (mode: ScanMode) => Promise<void>,
		private readonly onPushUnlinked: () => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.addClass('yuque-sync-scan-modal');
		const counts = this.getCounts();
		this.renderHeader();
		this.renderMetrics();
		this.renderStatusSummary(counts);
		this.renderActions(counts);
		this.renderFilters(counts);
		this.renderTable();
		this.renderRows();
	}

	onClose(): void {
		if (this.searchTimer !== null) {
			window.clearTimeout(this.searchTimer);
			this.searchTimer = null;
		}
		this.summaryButtons.clear();
		this.contentEl.empty();
	}

	private renderHeader(): void {
		const header = this.contentEl.createDiv({ cls: 'yuque-sync-scan-header' });
		const titleWrap = header.createDiv();
		titleWrap.createEl('h2', { text: '语雀同步状态' });
		titleWrap.createEl('p', {
			text: '优先查看需要处理的文档；可按状态或路径快速筛选。',
			cls: 'yuque-sync-scan-subtitle',
		});

		const badges = header.createDiv({ cls: 'yuque-sync-scan-badges' });
		badges.createSpan({
			text: this.summary.mode === 'full' ? '完整检测' : '增量检测',
			cls: 'yuque-sync-scan-badge is-primary',
		});
		if (this.summary.resumed) {
			badges.createSpan({ text: '已恢复进度', cls: 'yuque-sync-scan-badge' });
		}
		if (this.summary.canceled) {
			badges.createSpan({ text: '已暂停', cls: 'yuque-sync-scan-badge is-warning' });
		}
	}

	private renderMetrics(): void {
		const metrics = this.contentEl.createDiv({ cls: 'yuque-sync-scan-metrics' });
		this.createMetric(metrics, '文档总数', this.summary.total, '本次统计范围');
		this.createMetric(metrics, '实际检测', this.summary.scanned, '读取或重新计算');
		this.createMetric(metrics, '缓存复用', this.summary.cached, '未重复处理');
		this.createMetric(metrics, '远端正文', this.summary.remoteBodyRequests, '实际 API 正文请求');
		this.createMetric(metrics, '元数据命中', this.summary.remoteMetadataHits, '无需下载正文');
		this.createMetric(metrics, '耗时', formatDuration(this.summary.durationMs), '本次检测耗时');
	}

	private createMetric(parent: HTMLElement, label: string, value: string | number, hint: string): void {
		const card = parent.createDiv({ cls: 'yuque-sync-metric-card' });
		card.createSpan({ text: label, cls: 'yuque-sync-metric-label' });
		card.createEl('strong', { text: String(value), cls: 'yuque-sync-metric-value' });
		card.createSpan({ text: hint, cls: 'yuque-sync-metric-hint' });
	}

	private renderStatusSummary(counts: Map<SyncStatus, number>): void {
		const section = this.contentEl.createDiv({ cls: 'yuque-sync-scan-section' });
		const heading = section.createDiv({ cls: 'yuque-sync-section-heading' });
		heading.createEl('h3', { text: '状态概览' });
		heading.createSpan({ text: '点击状态即可筛选', cls: 'yuque-sync-section-hint' });

		const summary = section.createDiv({ cls: 'yuque-sync-scan-summary' });
		for (const status of SUMMARY_STATUSES) {
			const count = counts.get(status) ?? 0;
			if (count === 0) {
				continue;
			}
			const item = summary.createEl('button', {
				cls: `yuque-sync-summary-item is-${status}`,
				attr: { type: 'button', title: `筛选：${STATUS_LABELS[status]}` },
			});
			item.createSpan({ text: STATUS_LABELS[status], cls: 'yuque-sync-summary-label' });
			item.createEl('strong', { text: String(count) });
			item.addEventListener('click', () => {
				this.statusFilter = status;
				this.filterSelectEl.value = status;
				this.renderRows();
			});
			this.summaryButtons.set(status, item);
		}
	}

	private renderActions(counts: Map<SyncStatus, number>): void {
		const actions = this.contentEl.createDiv({ cls: 'yuque-sync-button-container yuque-sync-scan-actions' });
		const secondary = actions.createDiv({ cls: 'yuque-sync-action-group' });
		const primary = actions.createDiv({ cls: 'yuque-sync-action-group' });

		new ButtonComponent(secondary)
			.setButtonText('完整检测')
			.onClick(() => {
				this.close();
				void this.onScan('full');
			});

		if ((counts.get('unlinked') ?? 0) > 0) {
			new ButtonComponent(secondary)
				.setButtonText(`推送未关联 (${counts.get('unlinked') ?? 0})`)
				.onClick(() => {
					this.close();
					void this.onPushUnlinked();
				});
		}

		new ButtonComponent(primary)
			.setButtonText('重新增量检测')
			.setCta()
			.onClick(() => {
				this.close();
				void this.onScan('incremental');
			});
	}

	private renderFilters(counts: Map<SyncStatus, number>): void {
		const section = this.contentEl.createDiv({ cls: 'yuque-sync-scan-section' });
		const heading = section.createDiv({ cls: 'yuque-sync-section-heading' });
		heading.createEl('h3', { text: '文档列表' });
		this.resultInfoEl = heading.createSpan({ cls: 'yuque-sync-section-hint' });

		const toolbar = section.createDiv({ cls: 'yuque-sync-filter-toolbar' });
		const searchWrap = toolbar.createDiv({ cls: 'yuque-sync-search-wrap' });
		const search = searchWrap.createEl('input', {
			cls: 'yuque-sync-search-input',
			attr: {
				type: 'search',
				placeholder: '搜索文档路径、详情或语雀链接…',
				'aria-label': '搜索同步结果',
			},
		});
		search.addEventListener('input', () => {
			if (this.searchTimer !== null) {
				window.clearTimeout(this.searchTimer);
			}
			this.searchTimer = window.setTimeout(() => {
				this.searchTimer = null;
				this.searchQuery = search.value.trim().toLocaleLowerCase();
				this.renderRows();
			}, 120);
		});

		this.filterSelectEl = toolbar.createEl('select', {
			cls: 'yuque-sync-filter-select dropdown',
			attr: { 'aria-label': '按同步状态筛选' },
		});
		this.addFilterOption(this.filterSelectEl, 'all', `全部状态 (${this.results.length})`);
		const attentionCount = this.results.filter((result) => isAttentionStatus(result.status)).length;
		this.addFilterOption(this.filterSelectEl, 'attention', `需要处理 (${attentionCount})`);
		for (const status of SUMMARY_STATUSES) {
			const count = counts.get(status) ?? 0;
			if (count > 0) {
				this.addFilterOption(this.filterSelectEl, status, `${STATUS_LABELS[status]} (${count})`);
			}
		}
		this.filterSelectEl.value = this.statusFilter;
		this.filterSelectEl.addEventListener('change', () => {
			this.statusFilter = this.filterSelectEl.value as StatusFilter;
			this.renderRows();
		});

		this.limitNoteEl = section.createDiv({ cls: 'yuque-sync-scan-limit-note' });
	}

	private addFilterOption(select: HTMLSelectElement, value: StatusFilter, text: string): void {
		select.createEl('option', { text, attr: { value } });
	}

	private renderTable(): void {
		const tableWrap = this.contentEl.createDiv({ cls: 'yuque-sync-scan-table-wrap' });
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

	private renderRows(): void {
		const filtered = this.getFilteredResults();
		const visible = filtered.slice(0, MAX_VISIBLE_ROWS);
		this.tableBodyEl.empty();
		this.emptyEl.toggleClass('is-visible', filtered.length === 0);
		this.resultInfoEl.setText(`匹配 ${filtered.length} / ${this.results.length}`);

		for (const [status, button] of this.summaryButtons) {
			button.toggleClass('is-active', this.statusFilter === status);
		}

		if (filtered.length > MAX_VISIBLE_ROWS) {
			this.limitNoteEl.setText(`当前筛选命中 ${filtered.length} 条，仅渲染前 ${MAX_VISIBLE_ROWS} 条以保持界面流畅。继续缩小筛选或输入路径可定位其他文档。`);
			this.limitNoteEl.addClass('is-visible');
		} else {
			this.limitNoteEl.setText('');
			this.limitNoteEl.removeClass('is-visible');
		}

		for (const result of visible) {
			const row = this.tableBodyEl.createEl('tr', { cls: `is-${result.status}` });
			const statusCell = row.createEl('td');
			statusCell.createSpan({
				text: STATUS_LABELS[result.status],
				cls: `yuque-sync-status-pill is-${result.status}`,
			});

			const fileCell = row.createEl('td', { cls: 'yuque-sync-document-cell' });
			const fileButton = fileCell.createEl('button', {
				text: result.filePath,
				cls: 'yuque-sync-file-link',
				attr: { type: 'button', title: '在 Obsidian 中打开' },
			});
			fileButton.addEventListener('click', () => {
				void this.openLocalFile(result.filePath);
			});
			if (result.detail) {
				fileCell.createDiv({ text: result.detail, cls: 'yuque-sync-result-detail' });
			}

			const actionCell = row.createEl('td', { cls: 'yuque-sync-row-actions' });
			if (result.yuqueLink) {
				actionCell.createEl('a', {
					text: '打开语雀',
					cls: 'yuque-sync-external-link',
					attr: {
						href: result.yuqueLink,
						target: '_blank',
						rel: 'noopener noreferrer',
					},
				});
			} else {
				actionCell.createSpan({ text: '—', cls: 'yuque-sync-muted-action' });
			}
		}
	}

	private getFilteredResults(): SyncScanResult[] {
		return [...this.results]
			.filter((result) => {
				if (this.statusFilter === 'attention' && !isAttentionStatus(result.status)) {
					return false;
				}
				if (this.statusFilter !== 'all' && this.statusFilter !== 'attention' && result.status !== this.statusFilter) {
					return false;
				}
				if (!this.searchQuery) {
					return true;
				}
				const haystack = [
					result.filePath,
					result.detail ?? '',
					result.yuqueLink ?? '',
					STATUS_LABELS[result.status],
				].join('\n').toLocaleLowerCase();
				return haystack.includes(this.searchQuery);
			})
			.sort((left, right) => {
				const statusDiff = STATUS_ORDER[left.status] - STATUS_ORDER[right.status];
				return statusDiff || left.filePath.localeCompare(right.filePath);
			});
	}

	private getCounts(): Map<SyncStatus, number> {
		const counts = new Map<SyncStatus, number>();
		for (const result of this.results) {
			counts.set(result.status, (counts.get(result.status) ?? 0) + 1);
		}
		return counts;
	}

	private async openLocalFile(path: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			return;
		}
		await this.app.workspace.getLeaf(false).openFile(file);
	}
}
