import { App, Notice, normalizePath } from 'obsidian';
import { confirmImport } from './confirm-modal';
import { downloadAttachments } from './joplin/attachments';
import type { AttachmentSink } from './joplin/attachments';
import type { JoplinClient } from './joplin/client';
import { formatDateTime } from './joplin/frontmatter';
import { createFolders, writeNotes } from './joplin/importer';
import type { NoteSink } from './joplin/importer';
import { loadInventory } from './joplin/inventory';
import { planNotePaths } from './joplin/paths';
import { ReferenceCollector } from './joplin/references';
import { buildReport } from './joplin/report';
import { buildTagMapping, loadNotesByTag } from './joplin/tags';
import { DEFAULT_SETTINGS } from './settings';
import type { JoplinImporterSettings } from './settings';

/** Create every missing folder of a vault path, one level at a time. */
async function ensureFolder(app: App, folder: string): Promise<void> {
	let current = '';
	for (const part of folder.split('/')) {
		if (!part) continue;
		current = current ? `${current}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(current)) {
			await app.vault.createFolder(current);
		}
	}
}

/**
 * The import: read Joplin, plan the vault paths, ask for confirmation, download the referenced
 * attachments, create the folders and notes, then write a report note with the count check.
 * Joplin is only read. The import is meant to be run once (D-011).
 */
export async function runImport(app: App, client: JoplinClient, settings: JoplinImporterSettings): Promise<void> {
	let status = new Notice('Joplin: connecting...', 0);
	try {
		const inventory = await loadInventory(client, (stage, loaded) => {
			status.setMessage(`Joplin: loading ${stage} (${loaded})...`);
		});
		const notesByTag = await loadNotesByTag(client, inventory.tags, (done, total) => {
			status.setMessage(`Joplin: mapping tags (${done}/${total})...`);
		});
		const tagMapping = buildTagMapping(inventory.tags, notesByTag, inventory.noteIds);

		const importFolder = normalizePath(settings.importFolder || DEFAULT_SETTINGS.importFolder);
		const attachmentFolder = normalizePath(settings.attachmentFolder || DEFAULT_SETTINGS.attachmentFolder);
		const plan = planNotePaths(inventory.folderIndex, inventory.notes, { importFolder });
		const p = plan.report;
		status.hide();

		const confirmed = await confirmImport(
			app,
			`Import ${p.planned} of ${p.totalNotes} notes into "${importFolder}"? ` +
				`${p.skipped.length} notes will be skipped (HTML or encrypted). ` +
				'Joplin is only read, never changed. The import is meant to be run once.',
		);
		if (!confirmed) {
			new Notice('Joplin import cancelled.');
			return;
		}

		status = new Notice('Joplin: scanning note bodies...', 0);
		const collector = new ReferenceCollector(inventory.noteIds, inventory.resourceIds);
		for await (const page of client.notePagesWithBody()) {
			for (const note of page) collector.addNote(note.id, note.body ?? '');
		}
		const wanted = new Set(collector.report().referencedResourceIds);

		await ensureFolder(app, attachmentFolder);
		const attachmentSink: AttachmentSink = {
			exists: (path) => app.vault.getAbstractFileByPath(path) !== null,
			write: async (path, data) => {
				await app.vault.createBinary(path, data);
			},
		};
		const attachments = await downloadAttachments(
			client,
			inventory.resources,
			wanted,
			attachmentSink,
			attachmentFolder,
			(done, total) => {
				status.setMessage(`Joplin: downloading attachments (${done}/${total})...`);
			},
		);

		const noteSink: NoteSink = {
			exists: (path) => app.vault.getAbstractFileByPath(path) !== null,
			createFolder: async (path) => {
				await app.vault.createFolder(path);
			},
			createNote: async (path, content) => {
				await app.vault.create(path, content);
			},
		};
		const folders = await createFolders(plan.foldersToCreate, noteSink);
		const notes = await writeNotes(
			client.notePagesWithBody(),
			{ plan, tagsByNoteId: tagMapping.tagsByNoteId, attachmentPaths: attachments.pathById },
			noteSink,
			(done, total) => {
				status.setMessage(`Joplin: writing notes (${done}/${total})...`);
			},
		);

		const titleById = new Map(inventory.notes.map((n): [string, string] => [n.id, n.title]));
		const skipped = p.skipped.map((s) => ({ id: s.noteId, title: titleById.get(s.noteId) ?? '', reason: s.reason }));
		const report = buildReport({
			date: formatDateTime(Date.now()),
			importFolder,
			attachmentFolder,
			inventory: inventory.summary,
			paths: p,
			tags: tagMapping,
			referencedAttachments: wanted.size,
			attachments,
			folders,
			notes,
			skipped,
		});
		const reportPath = `${importFolder}/Import report.md`;
		let reportWritten = true;
		try {
			await ensureFolder(app, importFolder);
			await app.vault.create(reportPath, report);
		} catch (error) {
			reportWritten = false;
			console.error('Could not write the import report', error);
		}
		status.hide();

		const summary =
			`Import finished: ${notes.written} notes written, ${notes.failed.length} failed, ${p.skipped.length} skipped. ` +
			`Attachments: ${attachments.written + attachments.skippedExisting} of ${wanted.size}. ` +
			`References left over: ${notes.stats.leftover}. ` +
			(reportWritten ? `Report: ${reportPath}.` : 'The report note could not be written, see the console.');
		new Notice(summary, 20000);
		console.info(summary);
		if (notes.failed.length > 0) console.warn('Note failures', notes.failed);
		if (attachments.failed.length > 0) console.warn('Attachment failures', attachments.failed);
		if (folders.failed.length > 0) console.warn('Folder failures', folders.failed);
		if (notes.notFound.length > 0) console.warn('Planned notes not returned by Joplin', notes.notFound);
		if (notes.notesWithLeftover.length > 0) console.warn('Notes with references left over', notes.notesWithLeftover);
	} catch (error) {
		status.hide();
		console.error('Joplin import failed', error);
		const message = error instanceof Error ? error.message : 'unknown error';
		new Notice(`Joplin import failed: ${message}`);
	}
}
