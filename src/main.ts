import { Notice, Plugin } from 'obsidian';
import { JoplinClient, discoverJoplin } from './joplin/client';
import { loadInventory } from './joplin/inventory';
import { obsidianHttp } from './joplin/obsidian-http';
import { ReferenceCollector } from './joplin/references';
import { buildTagMapping, loadNotesByTag } from './joplin/tags';
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

		const progress = new Notice('Joplin: connecting...', 0);
		try {
			const client = new JoplinClient(baseUrl, this.settings.token, obsidianHttp);

			const inventory = await loadInventory(client, (stage, loaded) => {
				progress.setMessage(`Joplin: loading ${stage} (${loaded})...`);
			});

			const collector = new ReferenceCollector(inventory.noteIds, inventory.resourceIds);
			let scanned = 0;
			for await (const page of client.notePagesWithBody()) {
				for (const note of page) collector.addNote(note.id, note.body ?? '');
				scanned += page.length;
				progress.setMessage(`Joplin: scanning note bodies (${scanned}/${inventory.notes.length})...`);
			}
			const refs = collector.report();

			const notesByTag = await loadNotesByTag(client, inventory.tags, (done, total) => {
				progress.setMessage(`Joplin: mapping tags (${done}/${total})...`);
			});
			const tagMapping = buildTagMapping(inventory.tags, notesByTag, inventory.noteIds);
			progress.hide();

			const s = inventory.summary;
			const summary =
				`Joplin: ${s.notebooks} notebooks (${s.topLevelNotebooks} top-level, max depth ${s.maxDepth}), ` +
				`${s.notes} notes, ${s.tags} tags, ${s.resources} attachments.`;
			const refSummary =
				`References: ${refs.totalReferences} in ${refs.notesWithReferences} notes ` +
				`(${refs.imageToResource} images, ${refs.linkToNote} note links, ${refs.linkToResource} attachment links); ` +
				`${refs.unresolved.length} unresolved, ${refs.unparsedMentions} unparsed, ` +
				`${refs.unreferencedResourceIds.length} unreferenced attachments.`;
			const tagSummary =
				`Tags: ${tagMapping.notesWithTags} notes tagged, ${tagMapping.tagNoteLinks} tag links; ` +
				`${tagMapping.renamed.length} renamed for Obsidian, ${tagMapping.invalid.length} unusable, ` +
				`${tagMapping.collisions.length} merged by case or punctuation.`;
			new Notice(summary, 15000);
			new Notice(refSummary, 15000);
			new Notice(tagSummary, 15000);
			console.info(summary);
			console.info(refSummary);
			console.info(tagSummary);
			if (tagMapping.renamed.length > 0) console.info('Renamed tags', tagMapping.renamed);
			if (tagMapping.invalid.length > 0) console.info('Unusable tags', tagMapping.invalid);
			if (tagMapping.collisions.length > 0) console.info('Merged tags', tagMapping.collisions);

			const warnings: string[] = [];
			if (s.folderProblems > 0) warnings.push(`${s.folderProblems} notebook path problems`);
			if (s.orphanNotes > 0) warnings.push(`${s.orphanNotes} notes in unknown notebooks`);
			if (s.encryptedNotes > 0) warnings.push(`${s.encryptedNotes} encrypted notes`);
			if (tagMapping.unknownNoteRefs > 0) warnings.push(`${tagMapping.unknownNoteRefs} tag links to unknown notes`);
			if (warnings.length > 0) {
				const text = `Warnings: ${warnings.join(', ')}.`;
				new Notice(text, 15000);
				console.warn(text, inventory.folderIndex.problems);
			}
			if (refs.unresolved.length > 0 || refs.notesWithUnparsedMentions.length > 0) {
				console.warn('Reference details (note and Joplin ids only)', {
					unresolved: refs.unresolved,
					notesWithUnparsedMentions: refs.notesWithUnparsedMentions,
				});
			}
		} catch (error) {
			progress.hide();
			console.error('Joplin dry run failed', error);
			const message = error instanceof Error ? error.message : 'unknown error';
			new Notice(`Joplin request failed: ${message}`);
		}
	}
}
