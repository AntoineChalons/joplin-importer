import { requestUrl } from 'obsidian';
import type { HttpGet } from './http-types';

/** HttpGet backed by Obsidian's requestUrl. Does not throw on HTTP error statuses. */
export const obsidianHttp: HttpGet = async (url) => {
	const res = await requestUrl({ url, method: 'GET', throw: false });
	return {
		status: res.status,
		json: () => res.json as unknown,
		text: () => res.text,
		arrayBuffer: () => res.arrayBuffer,
	};
};
