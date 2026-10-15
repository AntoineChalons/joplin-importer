import { App, Modal, Setting } from 'obsidian';

class ConfirmModal extends Modal {
	private decided = false;

	constructor(
		app: App,
		private readonly message: string,
		private readonly onDecision: (confirmed: boolean) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('h3', { text: 'Import from Joplin' });
		contentEl.createEl('p', { text: this.message });
		new Setting(contentEl)
			.addButton((button) =>
				button
					.setButtonText('Import')
					.setCta()
					.onClick(() => {
						this.decided = true;
						this.onDecision(true);
						this.close();
					}),
			)
			.addButton((button) =>
				button.setButtonText('Cancel').onClick(() => {
					this.close();
				}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.decided) this.onDecision(false);
	}
}

/** Ask the user to confirm before anything is written. Resolves to false when the dialog is closed. */
export function confirmImport(app: App, message: string): Promise<boolean> {
	return new Promise((resolve) => {
		new ConfirmModal(app, message, resolve).open();
	});
}
