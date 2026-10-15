import { Notice, Plugin, normalizePath } from 'obsidian';
import { downloadAttachments } from './joplin/attachments';
import type { AttachmentSink } from './joplin/attachments';
import { JoplinClient, discoverJoplin } from './joplin/client';
import { loadInventory } from './joplin/inventory';
import { obsidianHttp } from './joplin/obsidian-http';
import { planNotePaths } from './joplin/paths';
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

		this.addCommand({
			id: 'download-attachments',
			name: 'Download referenced Joplin attachments',
			callback: () => {
				void this.downloadReferencedAttachments();
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

	/** Build a client from the settings, or tell the user what is missing and return null. */
	private async connect(): Promise<JoplinClient | null> {
		if (!this.settings.token) {
			new Notice('Set your Joplin API token in the plugin settings first.');
			return null;
		}

		const baseUrl = this.settings.baseUrl || (await discoverJoplin(obsidianHttp));
		if (!baseUrl) {
			new Notice('Joplin not found. Start Joplin and enable the Web Clipper service.');
			return null;
		}
		return new JoplinClient(baseUrl, this.settings.token, obsidianHttp);
	}

	/** Create every missing folder of a vault path, one level at a time. */
	private async ensureFolder(folder: string): Promise<void> {
		let current = '';
		for (const part of folder.split('/')) {
			if (!part) continue;
			current = current ? `${current}/${part}` : part;
			if (!this.app.vault.getAbstractFileByPath(current)) {
				await this.app.vault.createFolder(current);
			}
		}
	}

	private async dryRun(): Promise<void> {
		const client = await this.connect();
		if (!client) return;

		const progress = new Notice('Joplin: connecting...', 0);
		try {
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
			const pathPlan = planNotePaths(inventory.folderIndex, inventory.notes, {
				importFolder: this.settings.importFolder || DEFAULT_SETTINGS.importFolder,
			});
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
			const p = pathPlan.report;
			const htmlSkipped = p.skipped.filter((n) => n.reason === 'html').length;
			const encryptedSkipped = p.skipped.filter((n) => n.reason === 'encrypted').length;
			const pathSummary =
				`Paths: ${p.planned} of ${p.totalNotes} notes planned in ${pathPlan.foldersToCreate.length} folders; ` +
				`${p.skipped.length} skipped (${htmlSkipped} HTML, ${encryptedSkipped} encrypted), ${p.unfiled} unfiled; ` +
				`${p.collisionRenamedNotes} notes and ${p.collisionRenamedFolders} notebooks renamed for collisions; ` +
				`${p.sanitisedNotes} note titles and ${p.sanitisedFolders} notebook names cleaned, ` +
				`${p.untitledNotes} untitled, ${p.truncatedNames} truncated.`;
			new Notice(summary, 15000);
			new Notice(refSummary, 15000);
			new Notice(tagSummary, 15000);
			new Notice(pathSummary, 15000);
			console.info(summary);
			console.info(refSummary);
			console.info(tagSummary);
			console.info(pathSummary);
			if (tagMapping.renamed.length > 0) console.info('Renamed tags', tagMapping.renamed);
			if (tagMapping.invalid.length > 0) console.info('Unusable tags', tagMapping.invalid);
			if (tagMapping.collisions.length > 0) console.info('Merged tags', tagMapping.collisions);
			console.info('Planned paths', Array.from(pathPlan.notes.values()).map((n) => n.path));
			if (p.skipped.length > 0) console.warn('Skipped notes (Joplin ids)', p.skipped);

			const warnings: string[] = [];
			if (s.folderProblems > 0) warnings.push(`${s.folderProblems} notebook path problems`);
			if (s.orphanNotes > 0) warnings.push(`${s.orphanNotes} notes in unknown notebooks`);
			if (s.encryptedNotes > 0) warnings.push(`${s.encryptedNotes} encrypted notes`);
			if (htmlSkipped > 0) warnings.push(`${htmlSkipped} HTML notes will be skipped`);
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

	/** M6: download the attachments that notes reference into the attachment folder of the vault. */
	private async downloadReferencedAttachments(): Promise<void> {
		const client = await this.connect();
		if (!client) return;

		const progress = new Notice('Joplin: connecting...', 0);
		try {
			const inventory = await loadInventory(client, (stage, loaded) => {
				progress.setMessage(`Joplin: loading ${stage} (${loaded})...`);
			});

			const collector = new ReferenceCollector(inventory.noteIds, inventory.resourceIds);
			for await (const page of client.notePagesWithBody()) {
				for (const note of page) collector.addNote(note.id, note.body ?? '');
			}
			const wanted = new Set(collector.report().referencedResourceIds);

			const folder = normalizePath(this.settings.attachmentFolder || DEFAULT_SETTINGS.attachmentFolder);
			await this.ensureFolder(folder);
			const sink: AttachmentSink = {
				exists: (path) => this.app.vault.getAbstractFileByPath(path) !== null,
				write: async (path, data) => {
					await this.app.vault.createBinary(path, data);
				},
			};

			const report = await downloadAttachments(
				client,
				inventory.resources,
				wanted,
				sink,
				folder,
				(done, total) => {
					progress.setMessage(`Joplin: downloading attachments (${done}/${total})...`);
				},
			);
			progress.hide();

			const summary =
				`Attachments: ${report.requested} referenced; ${report.written} downloaded, ` +
				`${report.skippedExisting} already in the vault, ${report.failed.length} failed, ` +
				`${report.sizeMismatches.length} size mismatches (${report.bytes} bytes) in ${folder}.`;
			new Notice(summary, 15000);
			console.info(summary);
			console.info('Attachment paths (Joplin id to vault path)', Array.from(report.pathById.entries()));
			if (report.failed.length > 0) console.warn('Attachment failures', report.failed);
			if (report.sizeMismatches.length > 0) console.warn('Attachment size mismatches', report.sizeMismatches);
		} catch (error) {
			progress.hide();
			console.error('Joplin attachment download failed', error);
			const message = error instanceof Error ? error.message : 'unknown error';
			new Notice(`Joplin request failed: ${message}`);
		}
	}
}
