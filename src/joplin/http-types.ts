/** Minimal HTTP abstraction so the Joplin client can be tested without Obsidian. GET only. */
export interface HttpResponse {
	status: number;
	json(): unknown;
	text(): string;
	arrayBuffer(): ArrayBuffer;
}

export type HttpGet = (url: string) => Promise<HttpResponse>;
