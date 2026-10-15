import type { AttachmentReport } from './attachments';
import type { FolderReport, NoteWriteReport } from './importer';
import type { InventorySummary } from './inventory';
import type { PathReport } from './paths';
import type { TagMapping } from './tags';

export interface ReportInput {
	/** Date and time of the import, already formatted. */
	date: string;
	importFolder: string;
	attachmentFolder: string;
	inventory: InventorySummary;
	paths: PathReport;
	tags: TagMapping;
	/** Number of attachments that notes reference. */
	referencedAttachments: number;
	attachments: AttachmentReport;
	folders: FolderReport;
	notes: NoteWriteReport;
	/** Skipped notes with their title, for the list in the report. */
	skipped: { id: string; title: string; reason: string }[];
}

/** Keep titles from creating links, tags or tables inside the report. */
function plain(text: string): string {
	return text.replace(/[[\]|#^]/g, '-').replace(/\s+/g, ' ').trim();
}

function row(label: string, expected: number, actual: number): { line: string; ok: boolean } {
	const ok = expected === actual;
	return { line: `| ${label} | ${expected} | ${actual} | ${ok ? 'OK' : 'FAIL'} |`, ok };
}

/** The text of the import report note, including the count check against Joplin. */
export function buildReport(input: ReportInput): string {
	const { inventory, paths, notes, attachments, folders, tags } = input;
	const s = notes.stats;
	const t = notes.times;
	const checks = [
		row('Notes written plus skipped, against all Joplin notes', inventory.notes, notes.written + input.skipped.length),
		row('Notes that failed to write', 0, notes.failed.length),
		row('Planned notes Joplin did not return', 0, notes.notFound.length),
		row(
			'Referenced attachments in the vault',
			input.referencedAttachments,
			attachments.written + attachments.skippedExisting,
		),
		row('Attachment download failures', 0, attachments.failed.length),
		row('Attachment size mismatches', 0, attachments.sizeMismatches.length),
		row('Folders that failed to create', 0, folders.failed.length),
		row('References still in the Joplin form `:/id` outside code', 0, s.leftover),
	];
	const allOk = checks.every((c) => c.ok);
	const timesLost = t.ctimeApplied < t.ctimeRequested || t.mtimeApplied < t.mtimeRequested;

	const lines: string[] = [
		'---',
		'type: import-report',
		`created: ${input.date}`,
		'---',
		'# Joplin import report',
		'',
		`Imported on ${input.date} into \`${input.importFolder}\`. Attachments are in \`${input.attachmentFolder}\`.`,
		'',
		`Overall: ${allOk ? 'OK' : 'NEEDS ATTENTION'}`,
		'',
		'## Count check',
		'| Check | Expected | Actual | Result |',
		'|---|---|---|---|',
		...checks.map((c) => c.line),
		'',
		'## What was imported',
		`- Joplin: ${inventory.notebooks} notebooks, ${inventory.notes} notes, ${inventory.tags} tags, ${inventory.resources} attachments.`,
		`- Notes written: ${notes.written}. Skipped: ${input.skipped.length}. Unfiled: ${paths.unfiled}.`,
		`- Folders created: ${folders.created}. Already there: ${folders.existing}.`,
		`- Attachments downloaded: ${attachments.written}. Already there: ${attachments.skippedExisting}. Bytes: ${attachments.bytes}.`,
		`- File times from Joplin: creation time kept for ${t.ctimeApplied} of ${t.ctimeRequested} notes, modification time kept for ${t.mtimeApplied} of ${t.mtimeRequested} notes.`,
		...(timesLost
			? ['- Some file times were not kept; the original dates are always in the `created` and `updated` properties.']
			: []),
		`- Notes renamed for a name collision: ${paths.collisionRenamedNotes}. Notebooks renamed: ${paths.collisionRenamedFolders}.`,
		`- Note titles cleaned: ${paths.sanitisedNotes}. Notebook names cleaned: ${paths.sanitisedFolders}. Untitled notes: ${paths.untitledNotes}. Truncated names: ${paths.truncatedNames}.`,
		`- Tags: ${tags.notesWithTags} notes tagged, ${tags.tagNoteLinks} tag links, ${tags.renamed.length} tags renamed, ${tags.invalid.length} unusable, ${tags.collisions.length} merged.`,
		'',
		'## Links and embeds',
		`- Note links rewritten to wikilinks: ${s.noteLinks}.`,
		`- Images and attachments embedded: ${s.embeds}.`,
		`- Attachment links rewritten: ${s.attachmentLinks}.`,
		`- Images inside links split into an embed and a link: ${s.flattenedImageLinks}.`,
		`- Alt or link texts dropped to keep links valid: ${s.droppedAliases}.`,
		`- Mentions left as written inside code: ${s.insideCode}.`,
		`- References whose target is not in the vault: ${s.notImported}.`,
		`- Mentions left outside code: ${s.leftover}.`,
	];

	lines.push('', '## Skipped notes');
	if (input.skipped.length === 0) {
		lines.push('None.');
	} else {
		lines.push('These notes were not imported (HTML notes and encrypted notes are out of scope):');
		for (const n of input.skipped) lines.push(`- ${n.reason}: ${plain(n.title) || 'untitled'} (${n.id})`);
	}

	const problems: string[] = [];
	for (const f of notes.failed) problems.push(`- Note ${f.noteId}: ${plain(f.message)}`);
	for (const id of notes.notFound) problems.push(`- Note ${id}: not returned by Joplin`);
	for (const f of attachments.failed) problems.push(`- Attachment ${f.id}: ${plain(f.message)}`);
	for (const f of folders.failed) problems.push(`- Folder ${plain(f.path)}: ${plain(f.message)}`);
	for (const id of notes.notesWithLeftover) problems.push(`- Note ${id}: still contains a Joplin reference outside code`);
	lines.push('', '## Problems');
	if (problems.length === 0) lines.push('None.');
	else lines.push(...problems);

	return `${lines.join('\n')}\n`;
}
