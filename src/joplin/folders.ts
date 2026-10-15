import type { JoplinFolder } from './models';

export interface FolderInfo {
	id: string;
	title: string;
	parentId: string;
	/** Notebook titles from the top-level notebook down to this one (raw, not sanitised). */
	path: string[];
	depth: number;
}

export interface FolderProblem {
	id: string;
	kind: 'missing-parent' | 'cycle';
	detail: string;
}

export interface FolderIndex {
	byId: Map<string, FolderInfo>;
	/** Folders with no parent, or whose parent could not be found. */
	roots: string[];
	problems: FolderProblem[];
}

interface RawFolder {
	id: string;
	title: string;
	parentId: string;
}

function flatten(list: JoplinFolder[], parentId: string, out: RawFolder[]): void {
	for (const f of list) {
		out.push({ id: f.id, title: f.title, parentId: f.parent_id || parentId });
		if (f.children && f.children.length > 0) flatten(f.children, f.id, out);
	}
}

/** Build an id to path index from a flat list (parent_id) or a tree (children), or a mix. */
export function buildFolderIndex(folders: JoplinFolder[]): FolderIndex {
	const flat: RawFolder[] = [];
	flatten(folders, '', flat);

	const raw = new Map<string, RawFolder>();
	for (const f of flat) raw.set(f.id, f);

	const byId = new Map<string, FolderInfo>();
	const roots: string[] = [];
	const problems: FolderProblem[] = [];

	for (const f of raw.values()) {
		const titles: string[] = [];
		const seen = new Set<string>();
		let cur: RawFolder | undefined = f;

		while (cur) {
			if (seen.has(cur.id)) {
				problems.push({ id: f.id, kind: 'cycle', detail: `cycle through folder ${cur.id}` });
				break;
			}
			seen.add(cur.id);
			titles.push(cur.title);
			if (!cur.parentId) break;
			const parent: RawFolder | undefined = raw.get(cur.parentId);
			if (!parent) {
				problems.push({
					id: f.id,
					kind: 'missing-parent',
					detail: `parent folder ${cur.parentId} not found`,
				});
				break;
			}
			cur = parent;
		}

		const path = titles.reverse();
		byId.set(f.id, { id: f.id, title: f.title, parentId: f.parentId, path, depth: path.length - 1 });
		if (!f.parentId || !raw.has(f.parentId)) roots.push(f.id);
	}

	return { byId, roots, problems };
}

/** Path for a folder id, or an empty array if the id is unknown. */
export function pathFor(index: FolderIndex, folderId: string): string[] {
	return index.byId.get(folderId)?.path ?? [];
}
