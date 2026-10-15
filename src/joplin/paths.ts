import type { FolderIndex } from './folders';
import type { JoplinNote } from './models';

export const DEFAULT_IMPORT_FOLDER = 'Joplin import';
export const UNFILED_FOLDER = 'Unfiled';
const ATTACHMENTS_FOLDER = 'attachments';
const MAX_NAME_BYTES = 200;
const NOTE_EXTENSION = '.md';

// Characters unsafe in file names on common systems, plus control characters, plus the characters
// that break Obsidian links: # ^ [ ]. Folder names count too, because links use the full vault path.
const UNSAFE = /[\\/:*?"<>|#^[\]\u0000-\u001f]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export interface CleanName {
	name: string;
	/** The cleaned name differs from the input (and is not just the Untitled fallback). */
	changed: boolean;
	untitled: boolean;
	truncated: boolean;
}

function truncateBytes(text: string, max: number): string {
	const encoder = new TextEncoder();
	let bytes = 0;
	let out = '';
	for (const ch of text) {
		const size = encoder.encode(ch).length;
		if (bytes + size > max) break;
		bytes += size;
		out += ch;
	}
	return out;
}

/** Make one folder or note name safe for the vault. Never returns an empty name. */
export function sanitiseName(raw: string): CleanName {
	let name = raw
		.normalize('NFC')
		.replace(UNSAFE, '-')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^[.\s]+|[.\s]+$/g, '');

	let untitled = false;
	if (name === '') {
		name = 'Untitled';
		untitled = true;
	}

	const cut = truncateBytes(name, MAX_NAME_BYTES);
	const truncated = cut !== name;
	name = cut.replace(/[.\s]+$/g, '') || 'Untitled';

	if (WINDOWS_RESERVED.test(name.split('.')[0] ?? '')) name = `${name}_`;
	return { name, changed: !untitled && name !== raw, untitled, truncated };
}

function uniqueName(base: string, id: string, used: Set<string>): { name: string; renamed: boolean } {
	const candidates = [base, `${base} ${id.slice(0, 8)}`, `${base} ${id}`];
	const name = candidates.find((c) => !used.has(c.toLowerCase())) ?? `${base} ${id}`;
	used.add(name.toLowerCase());
	return { name, renamed: name !== base };
}

export type SkipReason = 'html' | 'encrypted';

export interface SkippedNote {
	noteId: string;
	reason: SkipReason;
}

export interface PlannedNote {
	noteId: string;
	/** Vault folder, for example `Joplin import/Work/Projects`. */
	folderPath: string;
	/** File name with extension. */
	fileName: string;
	/** Full vault path with extension. */
	path: string;
	/** Vault path without extension, for wikilinks. */
	linkTarget: string;
}

export interface PathReport {
	totalNotes: number;
	planned: number;
	skipped: SkippedNote[];
	/** Notes whose notebook is unknown; they go to the Unfiled folder. */
	unfiled: number;
	/** Note titles changed by cleaning. */
	sanitisedNotes: number;
	sanitisedFolders: number;
	untitledNotes: number;
	truncatedNames: number;
	/** Notes that got an id suffix because another note in the folder had the same name. */
	collisionRenamedNotes: number;
	/** Notebooks that got an id suffix because of a sibling or a reserved name. */
	collisionRenamedFolders: number;
}

export interface PathPlan {
	notes: Map<string, PlannedNote>;
	/** Folders to create, parents before children. Only folders that hold at least one planned note. */
	foldersToCreate: string[];
	report: PathReport;
}

export interface PlanOptions {
	/** Vault folder that holds everything that is imported. Default `Joplin import`. */
	importFolder?: string;
	/** Names that no top-level notebook may use. Default: `attachments` and `Unfiled`. */
	reservedRootNames?: readonly string[];
}

function skipReason(note: JoplinNote): SkipReason | null {
	if (note.encryption_applied) return 'encrypted';
	if ((note.markup_language ?? 1) !== 1) return 'html';
	return null;
}

/**
 * Decide the vault path of every note. Pure function: no vault access.
 * Rules: see D-010. Notes of one folder with the same name (compared without case) keep the
 * clean name for the earliest created note (then lowest id); the others get the first 8
 * characters of their id appended.
 */
export function planNotePaths(
	folderIndex: FolderIndex,
	notes: readonly JoplinNote[],
	options: PlanOptions = {},
): PathPlan {
	const root = (options.importFolder ?? DEFAULT_IMPORT_FOLDER).trim().replace(/^\/+|\/+$/g, '') || DEFAULT_IMPORT_FOLDER;
	const reserved = (options.reservedRootNames ?? [ATTACHMENTS_FOLDER, UNFILED_FOLDER]).map((r) => r.toLowerCase());

	const report: PathReport = {
		totalNotes: notes.length,
		planned: 0,
		skipped: [],
		unfiled: 0,
		sanitisedNotes: 0,
		sanitisedFolders: 0,
		untitledNotes: 0,
		truncatedNames: 0,
		collisionRenamedNotes: 0,
		collisionRenamedFolders: 0,
	};

	// Folder names: siblings share a parent; names are unique inside a parent without regard to case.
	const parentOf = new Map<string, string>();
	const siblings = new Map<string, string[]>();
	for (const info of folderIndex.byId.values()) {
		const parent = folderIndex.byId.has(info.parentId) ? info.parentId : '';
		parentOf.set(info.id, parent);
		const list = siblings.get(parent) ?? [];
		list.push(info.id);
		siblings.set(parent, list);
	}

	const folderName = new Map<string, string>();
	for (const [parent, ids] of siblings) {
		const used = new Set<string>(parent === '' ? reserved : []);
		for (const id of [...ids].sort()) {
			const info = folderIndex.byId.get(id);
			if (!info) continue;
			const clean = sanitiseName(info.title);
			if (clean.changed) report.sanitisedFolders++;
			if (clean.truncated) report.truncatedNames++;
			const unique = uniqueName(clean.name, id, used);
			if (unique.renamed) report.collisionRenamedFolders++;
			folderName.set(id, unique.name);
		}
	}

	// Folder paths: parent path plus own name; a cycle is cut by treating the repeated folder as top-level.
	const folderPath = new Map<string, string>();
	const resolving = new Set<string>();
	const pathOf = (id: string): string => {
		const cached = folderPath.get(id);
		if (cached !== undefined) return cached;
		resolving.add(id);
		const parent = parentOf.get(id) ?? '';
		const base = parent !== '' && !resolving.has(parent) ? pathOf(parent) : root;
		resolving.delete(id);
		const path = `${base}/${folderName.get(id) ?? 'Untitled'}`;
		folderPath.set(id, path);
		return path;
	};

	// Group the importable notes by target folder.
	const groups = new Map<string, JoplinNote[]>();
	for (const note of notes) {
		const reason = skipReason(note);
		if (reason) {
			report.skipped.push({ noteId: note.id, reason });
			continue;
		}
		let target: string;
		if (folderIndex.byId.has(note.parent_id)) {
			target = pathOf(note.parent_id);
		} else {
			target = `${root}/${UNFILED_FOLDER}`;
			report.unfiled++;
		}
		const list = groups.get(target) ?? [];
		list.push(note);
		groups.set(target, list);
	}

	const planned = new Map<string, PlannedNote>();
	const unknownTime = Number.MAX_SAFE_INTEGER;
	for (const [target, group] of groups) {
		const used = new Set<string>();
		const ordered = [...group].sort((a, b) => {
			const ta = a.user_created_time ?? unknownTime;
			const tb = b.user_created_time ?? unknownTime;
			if (ta !== tb) return ta < tb ? -1 : 1;
			return a.id < b.id ? -1 : 1;
		});
		for (const note of ordered) {
			const clean = sanitiseName(note.title ?? '');
			if (clean.changed) report.sanitisedNotes++;
			if (clean.untitled) report.untitledNotes++;
			if (clean.truncated) report.truncatedNames++;
			const unique = uniqueName(clean.name, note.id, used);
			if (unique.renamed) report.collisionRenamedNotes++;
			const fileName = `${unique.name}${NOTE_EXTENSION}`;
			planned.set(note.id, {
				noteId: note.id,
				folderPath: target,
				fileName,
				path: `${target}/${fileName}`,
				linkTarget: `${target}/${unique.name}`,
			});
		}
	}
	report.planned = planned.size;

	// Folders to create: every prefix of every target folder, parents first.
	const folders = new Set<string>();
	for (const target of groups.keys()) {
		const parts = target.split('/');
		for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join('/'));
	}
	const foldersToCreate = Array.from(folders).sort((a, b) => {
		const da = a.split('/').length;
		const db = b.split('/').length;
		if (da !== db) return da - db;
		return a < b ? -1 : a > b ? 1 : 0;
	});

	return { notes: planned, foldersToCreate, report };
}
