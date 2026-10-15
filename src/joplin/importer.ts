import type { JoplinNote } from './models';
import type { PathPlan } from './paths';
import { renderNote } from './render';
import type { RewriteStats } from './rewrite';

/** Creation and modification time to give a new file, in Unix milliseconds. */
export interface FileTimes {
	ctime?: number;
	mtime?: number;
}

/** The times a file really ended up with. */
export interface FileStat {
	ctime: number;
	mtime: number;
}

/** Where folders and notes are written. The plugin implements it with the Obsidian vault; tests use memory. */
export interface NoteSink {
	exists(path: string): boolean | Promise<boolean>;
	createFolder(path: string): Promise<void>;
	/**
	 * Create a new file with the given times (when set) and return the times it ended up with, when
	 * known. Must fail when the path already exists: nothing is ever overwritten.
	 */
	createNote(path: string, content: string, times?: FileTimes): Promise<FileStat | undefined>;
}

/** Two times closer than this count as equal: file systems may round the times they store. */
const TIME_TOLERANCE_MS = 2000;

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : 'unknown error';
}

/** The Joplin creation and update times of a note, only the ones that are set. */
export function fileTimes(note: JoplinNote): FileTimes {
	const times: FileTimes = {};
	if (typeof note.user_created_time === 'number' && note.user_created_time > 0) times.ctime = note.user_created_time;
	if (typeof note.user_updated_time === 'number' && note.user_updated_time > 0) times.mtime = note.user_updated_time;
	return times;
}

export interface FolderReport {
	created: number;
	existing: number;
	failed: { path: string; message: string }[];
}

/** Create the folders in the given order (parents before children). Existing folders are left alone. */
export async function createFolders(folders: readonly string[], sink: NoteSink): Promise<FolderReport> {
	const report: FolderReport = { created: 0, existing: 0, failed: [] };
	for (const path of folders) {
		try {
			if (await sink.exists(path)) {
				report.existing++;
			} else {
				await sink.createFolder(path);
				report.created++;
			}
		} catch (error) {
			report.failed.push({ path, message: errorMessage(error) });
		}
	}
	return report;
}

export function emptyStats(): RewriteStats {
	return {
		noteLinks: 0,
		embeds: 0,
		attachmentLinks: 0,
		droppedAliases: 0,
		flattenedImageLinks: 0,
		insideCode: 0,
		notImported: 0,
		leftover: 0,
	};
}

export interface WriteContext {
	plan: PathPlan;
	/** Obsidian tags per Joplin note id (from the tag mapping). */
	tagsByNoteId: ReadonlyMap<string, readonly string[]>;
	/** Joplin attachment id to the vault path of a file that is in the vault. */
	attachmentPaths: ReadonlyMap<string, string>;
}

export interface NoteWriteReport {
	written: number;
	failed: { noteId: string; message: string }[];
	/** Rewrite statistics added up over the notes that were written. */
	stats: RewriteStats;
	/** Written notes that still contain a `:/id` mention outside code. */
	notesWithLeftover: string[];
	/** Planned notes that Joplin never returned. */
	notFound: string[];
	/** How many file times were asked for, and how many the written files really have. */
	times: {
		ctimeRequested: number;
		ctimeApplied: number;
		mtimeRequested: number;
		mtimeApplied: number;
	};
}

/**
 * Render and create every planned note from pages of notes with bodies. Notes that are not in the
 * plan (skipped) are ignored. One failing note never stops the others.
 */
export async function writeNotes(
	pages: AsyncIterable<JoplinNote[]>,
	ctx: WriteContext,
	sink: NoteSink,
	onProgress?: (done: number, total: number) => void,
): Promise<NoteWriteReport> {
	const noteTargets = new Map<string, string>();
	for (const planned of ctx.plan.notes.values()) noteTargets.set(planned.noteId, planned.linkTarget);

	const report: NoteWriteReport = {
		written: 0,
		failed: [],
		stats: emptyStats(),
		notesWithLeftover: [],
		notFound: [],
		times: { ctimeRequested: 0, ctimeApplied: 0, mtimeRequested: 0, mtimeApplied: 0 },
	};
	const seen = new Set<string>();
	let done = 0;

	for await (const page of pages) {
		for (const note of page) {
			const planned = ctx.plan.notes.get(note.id);
			if (!planned) continue;
			seen.add(note.id);
			try {
				const { content, stats } = renderNote(note, {
					noteTargets,
					attachmentPaths: ctx.attachmentPaths,
					tags: ctx.tagsByNoteId.get(note.id) ?? [],
					fileStem: planned.fileName.replace(/\.md$/, ''),
				});
				const times = fileTimes(note);
				const actual = await sink.createNote(planned.path, content, times);
				report.written++;
				if (times.ctime !== undefined) {
					report.times.ctimeRequested++;
					if (actual && Math.abs(actual.ctime - times.ctime) < TIME_TOLERANCE_MS) report.times.ctimeApplied++;
				}
				if (times.mtime !== undefined) {
					report.times.mtimeRequested++;
					if (actual && Math.abs(actual.mtime - times.mtime) < TIME_TOLERANCE_MS) report.times.mtimeApplied++;
				}
				const total = report.stats;
				total.noteLinks += stats.noteLinks;
				total.embeds += stats.embeds;
				total.attachmentLinks += stats.attachmentLinks;
				total.droppedAliases += stats.droppedAliases;
				total.flattenedImageLinks += stats.flattenedImageLinks;
				total.insideCode += stats.insideCode;
				total.notImported += stats.notImported;
				total.leftover += stats.leftover;
				if (stats.leftover > 0) report.notesWithLeftover.push(note.id);
			} catch (error) {
				report.failed.push({ noteId: note.id, message: errorMessage(error) });
			}
			done++;
			onProgress?.(done, ctx.plan.notes.size);
		}
	}

	for (const id of ctx.plan.notes.keys()) {
		if (!seen.has(id)) report.notFound.push(id);
	}
	return report;
}
