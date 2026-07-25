import { App, ButtonComponent, Modal } from 'obsidian';

export class ConfirmModal extends Modal {
	private settled = false;
	private resolveResult: ((value: boolean) => void) | null = null;

	constructor(
		app: App,
		private readonly title: string,
		private readonly message?: string,
	) {
		super(app);
	}

	onOpen(): void {
		this.contentEl.createEl('h3', { text: this.title });
		if (this.message) {
			this.contentEl.createEl('p', { text: this.message, cls: 'yuque-sync-confirm-message' });
		}

		const actions = this.contentEl.createDiv({ cls: 'yuque-sync-button-container' });
		new ButtonComponent(actions)
			.setButtonText('取消')
			.onClick(() => this.finish(false));
		new ButtonComponent(actions)
			.setButtonText('确认')
			.setCta()
			.onClick(() => this.finish(true));
	}

	onClose(): void {
		this.contentEl.empty();
		this.finish(false, false);
	}

	private finish(result: boolean, close = true): void {
		if (this.settled) {
			return;
		}
		this.settled = true;
		this.resolveResult?.(result);
		if (close) {
			this.close();
		}
	}

	static show(app: App, title: string, message?: string): Promise<boolean> {
		return new Promise((resolve) => {
			const modal = new ConfirmModal(app, title, message);
			modal.resolveResult = resolve;
			modal.open();
		});
	}
}
