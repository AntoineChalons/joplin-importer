import { requestUrl } from 'obsidian';

export interface JoplinFolder {
	id: string;
	parent_id: string;
	title: string;
}

export interface JoplinNote {
	id: string;
	parent_id: string;
	title: string;
}

export interface JoplinTag {
	id: string;
	title: string;
}

interface Page<T> {
	items: T[];
	has_more: boolean;
}

const PING_RESPONSE = 'JoplinClipperServer';

/** Read-only client for the Joplin Data API. Only issues GET requests. */
export class JoplinClient {
	constructor(private readonly baseUrl: string, private readonly token: string) {}

	/** Look for a running Joplin Web Clipper service on ports 41184 to 41194. */
	static async discover(startPort = 41184, endPort = 41194): Promise<string | null> {
		for (let port = startPort; port <= endPort; port++) {
			const url = `http://127.0.0.1:${port}`;
			try {
				const res = await requestUrl({ url: `${url}/ping`, method: 'GET', throw: false });
				if (res.status === 200 && res.text.trim() === PING_RESPONSE) return url;
			} catch {
				// port closed, try the next one
			}
		}
		return null;
	}

	private async getPage<T>(path: string, fields: string, page: number): Promise<Page<T>> {
		const query = new URLSearchParams({
			fields,
			page: String(page),
			limit: '100',
			token: this.token,
		});
		const res = await requestUrl({
			url: `${this.baseUrl}${path}?${query.toString()}`,
			method: 'GET',
		});
		return res.json as Page<T>;
	}

	private async getAll<T>(path: string, fields: string): Promise<T[]> {
		const all: T[] = [];
		for (let page = 1; ; page++) {
			const result = await this.getPage<T>(path, fields, page);
			all.push(...result.items);
			if (!result.has_more) break;
		}
		return all;
	}

	listFolders(): Promise<JoplinFolder[]> {
		return this.getAll<JoplinFolder>('/folders', 'id,parent_id,title');
	}

	listNotes(): Promise<JoplinNote[]> {
		return this.getAll<JoplinNote>('/notes', 'id,parent_id,title');
	}

	listTags(): Promise<JoplinTag[]> {
		return this.getAll<JoplinTag>('/tags', 'id,title');
	}
}
