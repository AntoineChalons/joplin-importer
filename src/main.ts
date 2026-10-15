import { Notice, Plugin } from 'obsidian';
import { JoplinClient, discoverJoplin } from './joplin/client';
import { buildFolderIndex } from './joplin/folders';
import { obsidianHttp } from './joplin/obsidian-http';
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

		const baseUrl = this.settings.baseUrl || (await discoverJoplin(obsidianHttp));
		if (!baseUrl) {
			new Notice('Joplin not found. Start Joplin and enable the Web Clipper service.');
			return;
		}

		try {
			const client = new JoplinClient(baseUrl, this.settings.token, obsidianHttp);
			const [folders, notes, tags, resources] = await Promise.all([
				client.listFolders(),
				client.listNotes(),
				client.listTags(),
				client.listResources(),
			]);

			const index = buildFolderIndex(folders);
			const maxDepth = Math.max(0, ...Array.from(index.byId.values(), (f) => f.depth));
			const orphanNotes = notes.filter((n) => !index.byId.has(n.parent_id)).length;
			const encrypted = notes.filter((n) => Boolean(n.encryption_applied)).length;

			const summary =
				`Joplin: ${index.byId.size} notebooks (${index.roots.length} top-level, max depth ${maxDepth}), ` +
				`${notes.length} notes, ${tags.length} tags, ${resources.length} attachments.`;
			new Notice(summary);
			console.info(summary);

			const warnings: string[] = [];
			if (index.problems.length > 0) warnings.push(`${index.problems.length} notebook path problems`);
			if (orphanNotes > 0) warnings.push(`${orphanNotes} notes in unknown notebooks`);
			if (encrypted > 0) warnings.push(`${encrypted} encrypted notes`);
			if (warnings.length > 0) {
				const text = `Warnings: ${warnings.join(', ')}.`;
				new Notice(text);
				console.warn(text, index.problems);
			}
		} catch (error) {
			console.error('Joplin dry run failed', error);
			const message = error instanceof Error ? error.message : 'unknown error';
			new Notice(`Joplin request failed: ${message}`);
		}
	}
}
