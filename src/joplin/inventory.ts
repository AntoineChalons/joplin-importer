import type { JoplinClient } from './client';
import { buildFolderIndex } from './folders';
import type { FolderIndex } from './folders';
import type { JoplinNote, JoplinResource, JoplinTag } from './models';

export type InventoryStage = 'notebooks' | 'notes' | 'tags' | 'attachments';

/** Called as items load, with the stage name and the number loaded so far in that stage. */
export type InventoryProgress = (stage: InventoryStage, loaded: number) => void;

export interface InventorySummary {
	notebooks: number;
	topLevelNotebooks: number;
	maxDepth: number;
	notes: number;
	tags: number;
	resources: number;
	todos: number;
	encryptedNotes: number;
	orphanNotes: number;
	folderProblems: number;
}

export interface Inventory {
	folderIndex: FolderIndex;
	notes: JoplinNote[];
	tags: JoplinTag[];
	resources: JoplinResource[];
	noteIds: Set<string>;
	resourceIds: Set<string>;
	summary: InventorySummary;
}

export function summarize(
	folderIndex: FolderIndex,
	notes: JoplinNote[],
	tags: JoplinTag[],
	resources: JoplinResource[],
): InventorySummary {
	let maxDepth = 0;
	for (const f of folderIndex.byId.values()) {
		if (f.depth > maxDepth) maxDepth = f.depth;
	}
	return {
		notebooks: folderIndex.byId.size,
		topLevelNotebooks: folderIndex.roots.length,
		maxDepth,
		notes: notes.length,
		tags: tags.length,
		resources: resources.length,
		todos: notes.filter((n) => Boolean(n.is_todo)).length,
		encryptedNotes: notes.filter((n) => Boolean(n.encryption_applied)).length,
		orphanNotes: notes.filter((n) => !folderIndex.byId.has(n.parent_id)).length,
		folderProblems: folderIndex.problems.length,
	};
}

/** Pass 1 of the import: metadata only (no note bodies), loaded sequentially so progress is meaningful. */
export async function loadInventory(
	client: JoplinClient,
	onProgress?: InventoryProgress,
): Promise<Inventory> {
	const folders = await client.listFolders((n) => onProgress?.('notebooks', n));
	const notes = await client.listNotes((n) => onProgress?.('notes', n));
	const tags = await client.listTags((n) => onProgress?.('tags', n));
	const resources = await client.listResources((n) => onProgress?.('attachments', n));

	const folderIndex = buildFolderIndex(folders);
	return {
		folderIndex,
		notes,
		tags,
		resources,
		noteIds: new Set(notes.map((n) => n.id)),
		resourceIds: new Set(resources.map((r) => r.id)),
		summary: summarize(folderIndex, notes, tags, resources),
	};
}
