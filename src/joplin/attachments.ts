import type { JoplinClient } from './client';
import type { JoplinResource } from './models';
import { mapLimit } from './pool';

const MIME_EXTENSIONS: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/jpg': 'jpg',
	'image/png': 'png',
	'image/gif': 'gif',
	'image/webp': 'webp',
	'image/svg+xml': 'svg',
	'image/bmp': 'bmp',
	'image/heic': 'heic',
	'application/pdf': 'pdf',
	'application/zip': 'zip',
	'text/plain': 'txt',
	'text/markdown': 'md',
	'audio/mpeg': 'mp3',
	'audio/mp4': 'm4a',
	'audio/wav': 'wav',
	'video/mp4': 'mp4',
	'video/quicktime': 'mov',
};

// Characters unsafe in file names or in Obsidian links: \ / : * ? " < > | # ^ [ ] and control characters.
const UNSAFE_FILE_CHARS = /[\\/:*?"<>|#^[\]\u0000-\u001f]/g;
const MAX_STEM_LENGTH = 100;

/** File extension for an attachment: Joplin's `file_extension`, else from the mime type, else `bin`. */
export function extensionFor(resource: JoplinResource): string {
	const fromJoplin = (resource.file_extension ?? '').replace(/^\./, '').toLowerCase();
	if (/^[a-z0-9]{1,10}$/.test(fromJoplin)) return fromJoplin;
	const mime = (resource.mime ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
	return MIME_EXTENSIONS[mime] ?? 'bin';
}

/** Make a file name stem safe for the vault. May return an empty string. */
export function sanitiseFileStem(name: string): string {
	return name
		.replace(UNSAFE_FILE_CHARS, '-')
		.replace(/\s+/g, ' ')
		.replace(/-{2,}/g, '-')
		.trim()
		.replace(/^[.\-\s]+|[.\-\s]+$/g, '')
		.slice(0, MAX_STEM_LENGTH)
		.trim();
}

/**
 * Decide the vault file name of every attachment, independent of which ones get downloaded.
 * Name: sanitised original name without extension, or the Joplin id when the filename is empty.
 * Collisions (case-insensitive) get the first 8 characters of the id; resources are processed
 * in id order so the result does not depend on the order Joplin returns them.
 */
export function planAttachmentNames(resources: readonly JoplinResource[]): Map<string, string> {
	const used = new Set<string>();
	const names = new Map<string, string>();
	const sorted = [...resources].sort((a, b) => a.id.localeCompare(b.id));

	for (const resource of sorted) {
		const ext = extensionFor(resource);
		const stem = sanitiseFileStem((resource.filename ?? '').replace(/\.[A-Za-z0-9]{1,10}$/, '')) || resource.id;
		const candidates = [`${stem}.${ext}`, `${stem}-${resource.id.slice(0, 8)}.${ext}`, `${resource.id}.${ext}`];
		const name = candidates.find((c) => !used.has(c.toLowerCase())) ?? `${resource.id}.${ext}`;
		used.add(name.toLowerCase());
		names.set(resource.id, name);
	}
	return names;
}

/** Where downloaded files go. The plugin implements it with the Obsidian vault; tests use memory. */
export interface AttachmentSink {
	exists(path: string): boolean | Promise<boolean>;
	write(path: string, data: ArrayBuffer): Promise<void>;
}

export interface AttachmentReport {
	/** Attachments asked for. */
	requested: number;
	written: number;
	skippedExisting: number;
	bytes: number;
	failed: { id: string; message: string }[];
	/** Downloads whose size differs from the size Joplin reports (the file is still written). */
	sizeMismatches: { id: string; expected: number; actual: number }[];
	/** Vault path of every attachment that is now present (written or already there). */
	pathById: Map<string, string>;
}

function joinPath(folder: string, name: string): string {
	const base = folder.replace(/\/+$/, '');
	return base === '' ? name : `${base}/${name}`;
}

/**
 * Download the wanted attachments with bounded concurrency. Existing files are skipped, so a
 * re-run does not duplicate or overwrite. One failing download never stops the others; an
 * empty response is reported as a failure instead of writing an empty file.
 */
export async function downloadAttachments(
	client: JoplinClient,
	resources: readonly JoplinResource[],
	wanted: ReadonlySet<string>,
	sink: AttachmentSink,
	folder: string,
	onProgress?: (done: number, total: number) => void,
	concurrency = 2,
): Promise<AttachmentReport> {
	const names = planAttachmentNames(resources);
	const known = new Set(resources.map((r) => r.id));
	const todo = resources.filter((r) => wanted.has(r.id));

	const report: AttachmentReport = {
		requested: wanted.size,
		written: 0,
		skippedExisting: 0,
		bytes: 0,
		failed: [],
		sizeMismatches: [],
		pathById: new Map<string, string>(),
	};
	for (const id of wanted) {
		if (!known.has(id)) report.failed.push({ id, message: 'not in the Joplin attachment list' });
	}

	let done = 0;
	await mapLimit(todo, concurrency, async (resource) => {
		const path = joinPath(folder, names.get(resource.id) ?? `${resource.id}.bin`);
		try {
			if (await sink.exists(path)) {
				report.skippedExisting++;
				report.pathById.set(resource.id, path);
			} else {
				const data = await client.getResourceFile(resource.id);
				if (data.byteLength === 0 && (resource.size ?? 1) > 0) {
					throw new Error('empty response');
				}
				if (resource.size !== undefined && resource.size !== data.byteLength) {
					report.sizeMismatches.push({ id: resource.id, expected: resource.size, actual: data.byteLength });
				}
				await sink.write(path, data);
				report.written++;
				report.bytes += data.byteLength;
				report.pathById.set(resource.id, path);
			}
		} catch (error) {
			report.failed.push({ id: resource.id, message: error instanceof Error ? error.message : 'unknown error' });
		}
		done++;
		onProgress?.(done, todo.length);
	});
	return report;
}
