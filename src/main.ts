import { Notice, Plugin } from 'obsidian';
import { JoplinClient } from './joplin/client';
import { DEFAULT_SETTINGS, JoplinImporterSettings, JoplinImporterSettingTab } from './settings';

export default class JoplinImporterPlugin extends Plugin {
	settings: JoplinImporterSettings = { ...DEFAULT_SETTINGS };

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new JoplinImporterSettingTab(this.app, this));

		this.addCommand({
			id: 'dry-run',
			name: 'Dry run: count Joplin notes',
			callback: () => {
				void this.dryRun();
			},
		});
	}

	async loadSettings(): Promise<void> {
		const saved = (await this.loadData()) as Partial<JoplinImporterSettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...saved };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private async dryRun(): Promise<void> {
		if (!this.settings.token) {
			new Notice('Set your Joplin API token in the plugin settings first.');
			return;
		}

		const baseUrl = this.settings.baseUrl || (await JoplinClient.discover());
		if (!baseUrl) {
			new Notice('Joplin not found. Start Joplin and enable the Web Clipper service.');
			return;
		}

		try {
			const client = new JoplinClient(baseUrl, this.settings.token);
			const [folders, notes, tags] = await Promise.all([
				client.listFolders(),
				client.listNotes(),
				client.listTags(),
			]);
			new Notice(`Joplin: ${folders.length} notebooks, ${notes.length} notes, ${tags.length} tags.`);
		} catch (error) {
			console.error('Joplin dry run failed', error);
			new Notice('Joplin request failed. Check the token and URL; see the console for details.');
		}
	}
}
