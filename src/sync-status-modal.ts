import { App, ButtonComponent, Modal } from 'obsidian';
import type { ScanMode, ScanSummary, SyncScanResult, SyncStatus } from './types';

const MAX_VISIBLE_ROWS = 500;

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

export class SyncStatusModal extends Modal {
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
		this.contentEl.createEl('h2', { text: '语雀同步状态' });

		const scanMeta = this.contentEl.createDiv({ cls: 'yuque-sync-scan-meta' });
		const modeLabel = this.summary.mode === 'full' ? '完整检测' : '增量检测';
		const flags = [
			this.summary.resumed ? '已恢复上次进度' : '',
			this.summary.canceled ? '已暂停，可下次继续' : '',
		].filter(Boolean);
		scanMeta.createEl('p', {
			text: `${modeLabel}：实际处理 ${this.summary.scanned} / ${this.summary.total}，复用缓存 ${this.summary.cached}，耗时 ${formatDuration(this.summary.durationMs)}${flags.length ? `；${flags.join('；')}` : ''}`,
		});
		scanMeta.createEl('p', {
			text: `远端优化：元数据直接确认 ${this.summary.remoteMetadataHits} 篇，正文请求 ${this.summary.remoteBodyRequests} 次。`,
		});

		const counts = new Map<SyncStatus, number>();
		for (const result of this.results) {
			counts.set(result.status, (counts.get(result.status) ?? 0) + 1);
		}

		const summary = this.contentEl.createDiv({ cls: 'yuque-sync-scan-summary' });
		const summaryStatuses: SyncStatus[] = [
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
		for (const status of summaryStatuses) {
			const count = counts.get(status) ?? 0;
			if (count === 0) {
				continue;
			}
			const item = summary.createDiv({ cls: `yuque-sync-summary-item is-${status}` });
			item.createSpan({ text: STATUS_LABELS[status] });
			item.createEl('strong', { text: String(count) });
		}

		const actions = this.contentEl.createDiv({ cls: 'yuque-sync-button-container' });
		new ButtonComponent(actions)
			.setButtonText('增量检测')
			.setCta()
			.onClick(() => {
				this.close();
				void this.onScan('incremental');
			});
		new ButtonComponent(actions)
			.setButtonText('完整检测')
			.onClick(() => {
				this.close();
				void this.onScan('full');
			});
		if ((counts.get('unlinked') ?? 0) > 0) {
			new ButtonComponent(actions)
				.setButtonText(`推送未关联文档 (${counts.get('unlinked') ?? 0})`)
				.onClick(() => {
					this.close();
					void this.onPushUnlinked();
				});
		}

		const sorted = [...this.results].sort((left, right) => {
			const statusDiff = STATUS_ORDER[left.status] - STATUS_ORDER[right.status];
			return statusDiff || left.filePath.localeCompare(right.filePath);
		});
		const visible = sorted.slice(0, MAX_VISIBLE_ROWS);
		if (sorted.length > MAX_VISIBLE_ROWS) {
			this.contentEl.createEl('p', {
				cls: 'yuque-sync-scan-limit-note',
				text: `为避免 15,000+ 笔记时大量 DOM 节点造成界面卡顿，列表仅显示优先级最高的前 ${MAX_VISIBLE_ROWS} 条；上方统计包含全部 ${sorted.length} 条。`,
			});
		}

		const tableWrap = this.contentEl.createDiv({ cls: 'yuque-sync-scan-table-wrap' });
		const table = tableWrap.createEl('table', { cls: 'yuque-sync-scan-table' });
		const head = table.createEl('thead').createEl('tr');
		head.createEl('th', { text: '状态' });
		head.createEl('th', { text: '文档' });
		head.createEl('th', { text: '详情' });
		head.createEl('th', { text: '语雀' });

		const body = table.createEl('tbody');
		for (const result of visible) {
			const row = body.createEl('tr', { cls: `is-${result.status}` });
			row.createEl('td', { text: STATUS_LABELS[result.status] });
			const fileCell = row.createEl('td');
			fileCell.createEl('code', { text: result.filePath });
			row.createEl('td', { text: result.detail ?? '' });
			const linkCell = row.createEl('td');
			if (result.yuqueLink) {
				linkCell.createEl('a', {
					text: '打开',
					attr: {
						href: result.yuqueLink,
						target: '_blank',
						rel: 'noopener noreferrer',
					},
				});
			}
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
