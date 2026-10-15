/** A Joplin internal reference found in a note body: an image embed or a link to a note or attachment. */
export interface JoplinRef {
	kind: 'image' | 'link';
	id: string;
	text: string;
}

// Markdown: ![alt](:/id) or [text](:/id), optionally with #anchor and/or "title".
const MD_REF = /(!?)\[([^\]]*)\]\(:\/([0-9a-f]{32})(?:#[^)\s"]*)?(?:\s+"[^"]*")?\)/g;
// HTML: <img src=":/id" ...>
const HTML_IMG = /<img\b[^>]*?\bsrc=["']:\/([0-9a-f]{32})["'][^>]*>/gi;
// Any mention of :/ followed by an id, to detect forms the scanner does not understand.
const RAW_ID = /:\/[0-9a-f]{32}/g;

export function scanReferences(body: string): JoplinRef[] {
	const refs: JoplinRef[] = [];
	for (const m of body.matchAll(MD_REF)) {
		const id = m[3];
		if (!id) continue;
		refs.push({ kind: m[1] === '!' ? 'image' : 'link', id, text: m[2] ?? '' });
	}
	for (const m of body.matchAll(HTML_IMG)) {
		const id = m[1];
		if (!id) continue;
		refs.push({ kind: 'image', id, text: '' });
	}
	return refs;
}

export function countIdMentions(body: string): number {
	return Array.from(body.matchAll(RAW_ID)).length;
}

export interface UnresolvedRef {
	noteId: string;
	id: string;
	kind: 'image' | 'link';
}

export interface ReferenceReport {
	notesScanned: number;
	notesWithReferences: number;
	totalReferences: number;
	imageToResource: number;
	linkToNote: number;
	linkToResource: number;
	imageToNote: number;
	/** References whose id is neither a known note nor a known attachment. */
	unresolved: UnresolvedRef[];
	/** Mentions of `:/id` that the scanner did not parse as a reference (for example a bare id in text). */
	unparsedMentions: number;
	notesWithUnparsedMentions: string[];
	referencedResourceIds: string[];
	unreferencedResourceIds: string[];
}

/** Accumulates reference statistics note by note, so it works with streamed pages of bodies. */
export class ReferenceCollector {
	private notesScanned = 0;
	private notesWithReferences = 0;
	private totalReferences = 0;
	private imageToResource = 0;
	private linkToNote = 0;
	private linkToResource = 0;
	private imageToNote = 0;
	private unparsedMentions = 0;
	private readonly unresolved: UnresolvedRef[] = [];
	private readonly notesWithUnparsed: string[] = [];
	private readonly referenced = new Set<string>();

	constructor(
		private readonly noteIds: ReadonlySet<string>,
		private readonly resourceIds: ReadonlySet<string>,
	) {}

	addNote(noteId: string, body: string): void {
		this.notesScanned++;
		const refs = scanReferences(body);
		if (refs.length > 0) this.notesWithReferences++;

		for (const ref of refs) {
			this.totalReferences++;
			if (this.resourceIds.has(ref.id)) {
				this.referenced.add(ref.id);
				if (ref.kind === 'image') this.imageToResource++;
				else this.linkToResource++;
			} else if (this.noteIds.has(ref.id)) {
				if (ref.kind === 'link') this.linkToNote++;
				else this.imageToNote++;
			} else {
				this.unresolved.push({ noteId, id: ref.id, kind: ref.kind });
			}
		}

		const extra = countIdMentions(body) - refs.length;
		if (extra > 0) {
			this.unparsedMentions += extra;
			this.notesWithUnparsed.push(noteId);
		}
	}

	report(): ReferenceReport {
		const referencedResourceIds = Array.from(this.referenced).sort();
		return {
			notesScanned: this.notesScanned,
			notesWithReferences: this.notesWithReferences,
			totalReferences: this.totalReferences,
			imageToResource: this.imageToResource,
			linkToNote: this.linkToNote,
			linkToResource: this.linkToResource,
			imageToNote: this.imageToNote,
			unresolved: [...this.unresolved],
			unparsedMentions: this.unparsedMentions,
			notesWithUnparsedMentions: [...this.notesWithUnparsed],
			referencedResourceIds,
			unreferencedResourceIds: Array.from(this.resourceIds)
				.filter((id) => !this.referenced.has(id))
				.sort(),
		};
	}
}
