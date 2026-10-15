import type { JoplinClient } from './client';
import type { JoplinTag } from './models';
import { mapLimit } from './pool';

// ASCII characters Obsidian tags cannot contain (everything except 0-9 A-Z a-z _ - /).
const DISALLOWED_ASCII = /[\u0000-\u002C\u002E\u003A-\u0040\u005B-\u005E\u0060\u007B-\u007F]/g;

/**
 * Convert a Joplin tag title to a valid Obsidian tag name, or null if nothing usable remains.
 * Rules (Obsidian Tags help): letters, numbers, _ - / and Unicode characters; no spaces;
 * at least one non-numeric character; case-insensitive. Non-ASCII characters are kept as they are.
 */
export function toObsidianTag(title: string): string | null {
	let t = title.trim();
	t = t.replace(/\s+/g, '-');
	t = t.replace(DISALLOWED_ASCII, '-');
	t = t.replace(/-{2,}/g, '-');
	t = t.replace(/\/{2,}/g, '/');
	t = t.replace(/^[-/]+|[-/]+$/g, '');
	if (t === '') return null;
	// A tag needs a character that is not a digit; be conservative and also exclude - _ /.
	if (!/[^\d\-_/]/u.test(t)) t = `tag-${t}`;
	return t;
}

/** Load, for every tag, the ids of its notes (GET /tags/:id/notes), with bounded concurrency. */
export async function loadNotesByTag(
	client: JoplinClient,
	tags: readonly JoplinTag[],
	onProgress?: (done: number, total: number) => void,
	concurrency = 4,
): Promise<Map<string, string[]>> {
	let done = 0;
	const lists = await mapLimit(tags, concurrency, async (tag) => {
		const ids = await client.listNoteIdsForTag(tag.id);
		done++;
		onProgress?.(done, tags.length);
		return ids;
	});
	const result = new Map<string, string[]>();
	tags.forEach((tag, i) => result.set(tag.id, lists[i] ?? []));
	return result;
}

export interface TagMapping {
	/** Obsidian tag names per Joplin note id (deduplicated, sorted). */
	tagsByNoteId: Map<string, string[]>;
	tagCount: number;
	notesWithTags: number;
	tagNoteLinks: number;
	/** Tags whose name had to change to be valid in Obsidian. */
	renamed: { original: string; obsidian: string }[];
	/** Tag titles with no usable Obsidian form; their notes lose that tag. */
	invalid: string[];
	/** Different Joplin tags that become the same Obsidian tag (Obsidian tags are case-insensitive). */
	collisions: { obsidian: string; originals: string[] }[];
	/** Tag to note links pointing at a note id that is not in the inventory. */
	unknownNoteRefs: number;
}

export function buildTagMapping(
	tags: readonly JoplinTag[],
	notesByTag: ReadonlyMap<string, string[]>,
	noteIds: ReadonlySet<string>,
): TagMapping {
	const working = new Map<string, Set<string>>();
	const renamed: { original: string; obsidian: string }[] = [];
	const invalid: string[] = [];
	const canonical = new Map<string, string>();
	const originalsByKey = new Map<string, string[]>();
	let unknownNoteRefs = 0;

	for (const tag of tags) {
		const converted = toObsidianTag(tag.title);
		if (converted === null) {
			invalid.push(tag.title);
			continue;
		}
		if (converted !== tag.title) renamed.push({ original: tag.title, obsidian: converted });

		const key = converted.toLowerCase();
		if (!canonical.has(key)) canonical.set(key, converted);
		const obsidian = canonical.get(key) ?? converted;
		const originals = originalsByKey.get(key) ?? [];
		originals.push(tag.title);
		originalsByKey.set(key, originals);

		for (const noteId of notesByTag.get(tag.id) ?? []) {
			if (!noteIds.has(noteId)) {
				unknownNoteRefs++;
				continue;
			}
			let set = working.get(noteId);
			if (!set) {
				set = new Set<string>();
				working.set(noteId, set);
			}
			set.add(obsidian);
		}
	}

	const tagsByNoteId = new Map<string, string[]>();
	let tagNoteLinks = 0;
	for (const [noteId, set] of working) {
		const list = Array.from(set).sort();
		tagsByNoteId.set(noteId, list);
		tagNoteLinks += list.length;
	}

	const collisions: { obsidian: string; originals: string[] }[] = [];
	for (const [key, originals] of originalsByKey) {
		if (originals.length > 1) collisions.push({ obsidian: canonical.get(key) ?? key, originals });
	}

	return {
		tagsByNoteId,
		tagCount: tags.length,
		notesWithTags: tagsByNoteId.size,
		tagNoteLinks,
		renamed,
		invalid,
		collisions,
		unknownNoteRefs,
	};
}
