import type { HttpGet, HttpResponse } from './http-types';
import type { JoplinFolder, JoplinNote, JoplinResource, JoplinTag } from './models';

const PING_RESPONSE = 'JoplinClipperServer';
const PAGE_SIZE = 100;
const MAX_PAGES = 10000;

export const NOTE_META_FIELDS =
	'id,parent_id,title,user_created_time,user_updated_time,is_todo,todo_due,todo_completed,source_url,author,markup_language,encryption_applied';
export const NOTE_BODY_FIELDS = `${NOTE_META_FIELDS},body`;
export const RESOURCE_FIELDS = 'id,mime,filename,file_extension,size';

/** Called after each page with the number of items loaded so far. */
export type LoadProgress = (loaded: number) => void;

interface Page<T> {
	items?: T[];
	has_more?: boolean;
}

export class JoplinApiError extends Error {
	readonly status: number;
	readonly path: string;

	constructor(status: number, path: string, message: string) {
		super(message);
		this.name = 'JoplinApiError';
		this.status = status;
		this.path = path;
	}
}

/** Build an error without the URL (the URL contains the token) and with only the first line of Joplin's message. */
function toApiError(path: string, res: HttpResponse): JoplinApiError {
	let detail = '';
	try {
		const body = res.json() as { error?: unknown } | null;
		if (body && typeof body.error === 'string') {
			detail = (body.error.split('\n')[0] ?? '').trim();
		}
	} catch {
		// body was not JSON
	}
	const suffix = detail ? `: ${detail}` : '';
	return new JoplinApiError(res.status, path, `Joplin API error ${res.status} on ${path}${suffix}`);
}

/** Look for a running Joplin Web Clipper service on ports 41184 to 41194. */
export async function discoverJoplin(
	http: HttpGet,
	startPort = 41184,
	endPort = 41194,
): Promise<string | null> {
	for (let port = startPort; port <= endPort; port++) {
		const url = `http://127.0.0.1:${port}`;
		try {
			const res = await http(`${url}/ping`);
			if (res.status === 200 && res.text().trim() === PING_RESPONSE) return url;
		} catch {
			// port closed, try the next one
		}
	}
	return null;
}

/** Read-only client for the Joplin Data API. Only issues GET requests. */
export class JoplinClient {
	private readonly baseUrl: string;

	constructor(
		baseUrl: string,
		private readonly token: string,
		private readonly http: HttpGet,
	) {
		this.baseUrl = baseUrl.replace(/\/+$/, '');
	}

	private url(path: string, params: Record<string, string> = {}): string {
		const query = new URLSearchParams({ ...params, token: this.token });
		return `${this.baseUrl}${path}?${query.toString()}`;
	}

	private async getJson<T>(path: string, params: Record<string, string> = {}): Promise<T> {
		const res = await this.http(this.url(path, params));
		if (res.status >= 400) throw toApiError(path, res);
		return res.json() as T;
	}

	/** Download a binary payload, for example a resource file. */
	async getBinary(path: string): Promise<ArrayBuffer> {
		const res = await this.http(this.url(path));
		if (res.status >= 400) throw toApiError(path, res);
		return res.arrayBuffer();
	}

	/** Yield one page of items at a time. A missing has_more is treated as the last page. */
	async *pages<T>(path: string, fields?: string): AsyncGenerator<T[]> {
		for (let page = 1; page <= MAX_PAGES; page++) {
			const params: Record<string, string> = { page: String(page), limit: String(PAGE_SIZE) };
			if (fields) params.fields = fields;
			const result = await this.getJson<Page<T>>(path, params);
			if (!Array.isArray(result.items)) {
				throw new Error(`Unexpected response from Joplin on ${path}: no items array`);
			}
			yield result.items;
			if (!result.has_more || result.items.length === 0) return;
		}
		throw new Error(`Too many pages on ${path}`);
	}

	private async getAll<T>(path: string, fields?: string, onProgress?: LoadProgress): Promise<T[]> {
		const all: T[] = [];
		for await (const items of this.pages<T>(path, fields)) {
			all.push(...items);
			onProgress?.(all.length);
		}
		return all;
	}

	/** Folders are requested with default fields so a tree response keeps its children. */
	listFolders(onProgress?: LoadProgress): Promise<JoplinFolder[]> {
		return this.getAll<JoplinFolder>('/folders', undefined, onProgress);
	}

	listNotes(onProgress?: LoadProgress): Promise<JoplinNote[]> {
		return this.getAll<JoplinNote>('/notes', NOTE_META_FIELDS, onProgress);
	}

	/** Pages of notes including their body, for streaming conversion. */
	notePagesWithBody(): AsyncGenerator<JoplinNote[]> {
		return this.pages<JoplinNote>('/notes', NOTE_BODY_FIELDS);
	}

	listTags(onProgress?: LoadProgress): Promise<JoplinTag[]> {
		return this.getAll<JoplinTag>('/tags', 'id,title', onProgress);
	}

	listResources(onProgress?: LoadProgress): Promise<JoplinResource[]> {
		return this.getAll<JoplinResource>('/resources', RESOURCE_FIELDS, onProgress);
	}

	getResourceFile(id: string): Promise<ArrayBuffer> {
		return this.getBinary(`/resources/${id}/file`);
	}
}
