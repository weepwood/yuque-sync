import { App, ButtonComponent, Modal } from 'obsidian';
import type { SyncScanResult, SyncStatus } from './types';

const STATUS_LABELS: Record<SyncStatus, string> = {
	synced: '已同步',
	different: '内容不同',
	unlinked: '未关联',
	'invalid-link': '链接异常',
	'remote-missing': '远端不存在',
	'yaml-error': 'YAML 异常',
	ignored: '已忽略',
	error: '检测失败',
};

const STATUS_ORDER: Record<SyncStatus, number> = {
	unlinked: 0,
	different: 1,
	'invalid-link': 2,
	'remote-missing': 3,
	'yaml-error': 4,
	error: 5,
	ignored: 6,
	synced: 7,
};

export class SyncStatusModal extends Modal {
	constructor(
		app: App,
		private readonly results: SyncScanResult[],
		private readonly onRescan: () => Promise<void>,
		private readonly onPushUnlinked: () => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.addClass('yuque-sync-scan-modal');
		this.contentEl.createEl('h2', { text: '语雀同步状态' });

		const counts = new Map<SyncStatus, number>();
		for (const result of this.results) {
			counts.set(result.status, (counts.get(result.status) ?? 0) + 1);
		}

		const summary = this.contentEl.createDiv({ cls: 'yuque-sync-scan-summary' });
		const summaryStatuses: SyncStatus[] = [
			'synced', 'different', 'unlinked', 'invalid-link', 'remote-missing', 'yaml-error', 'error', 'ignored',
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
			.setButtonText('重新检测')
			.onClick(() => {
				this.close();
				void this.onRescan();
			});
		if ((counts.get('unlinked') ?? 0) > 0) {
			new ButtonComponent(actions)
				.setButtonText(`推送未关联文档 (${counts.get('unlinked') ?? 0})`)
				.setCta()
				.onClick(() => {
					this.close();
					void this.onPushUnlinked();
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
		for (const result of [...this.results].sort((left, right) => {
			const statusDiff = STATUS_ORDER[left.status] - STATUS_ORDER[right.status];
			return statusDiff || left.filePath.localeCompare(right.filePath);
		})) {
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
