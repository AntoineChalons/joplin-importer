import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JoplinApiError, JoplinClient, discoverJoplin } from '../src/joplin/client';

function fakeHttp(handler) {
	const calls = [];
	const http = async (url) => {
		const u = new URL(url);
		calls.push(u);
		const r = handler(u);
		return {
			status: r.status ?? 200,
			json: () => r.body,
			text: () => r.text ?? JSON.stringify(r.body),
			arrayBuffer: () => r.bytes ?? new ArrayBuffer(0),
		};
	};
	return { http, calls };
}

function pagedNotes(total) {
	const all = Array.from({ length: total }, (_, i) => ({ id: `n${i}`, parent_id: 'f', title: `Note ${i}` }));
	return (u) => {
		const page = Number(u.searchParams.get('page'));
		const limit = Number(u.searchParams.get('limit'));
		const start = (page - 1) * limit;
		return { body: { items: all.slice(start, start + limit), has_more: start + limit < all.length } };
	};
}

test('paging: 250 notes are fetched in 3 pages with token, limit and fields', async () => {
	const { http, calls } = fakeHttp(pagedNotes(250));
	const client = new JoplinClient('http://127.0.0.1:41184/', 'TOKEN', http);
	const notes = await client.listNotes();
	assert.equal(notes.length, 250);
	assert.equal(calls.length, 3);
	assert.equal(calls[0].pathname, '/notes');
	assert.equal(calls[0].searchParams.get('token'), 'TOKEN');
	assert.equal(calls[0].searchParams.get('limit'), '100');
	assert.ok(calls[0].searchParams.get('fields').includes('markup_language'));
});

test('a response without has_more is treated as the last page', async () => {
	const { http, calls } = fakeHttp(() => ({ body: { items: [{ id: 't1', title: 'x' }] } }));
	const client = new JoplinClient('http://127.0.0.1:41184', 'TOKEN', http);
	const tags = await client.listTags();
	assert.equal(tags.length, 1);
	assert.equal(calls.length, 1);
});

test('folders are requested without a fields parameter', async () => {
	const { http, calls } = fakeHttp(() => ({ body: { items: [], has_more: false } }));
	const client = new JoplinClient('http://127.0.0.1:41184', 'TOKEN', http);
	await client.listFolders();
	assert.equal(calls[0].searchParams.get('fields'), null);
});

test('HTTP errors become JoplinApiError without leaking the token', async () => {
	const { http } = fakeHttp(() => ({
		status: 403,
		body: { error: 'Invalid "token" parameter: \n\nError: stack trace line' },
	}));
	const client = new JoplinClient('http://127.0.0.1:41184', 'SECRET123', http);
	await assert.rejects(client.listTags(), (err) => {
		assert.ok(err instanceof JoplinApiError);
		assert.equal(err.status, 403);
		assert.ok(!err.message.includes('SECRET123'));
		assert.ok(!err.message.includes('stack trace'));
		return true;
	});
});

test('getResourceFile returns the binary payload', async () => {
	const bytes = new Uint8Array([1, 2, 3]).buffer;
	const { http, calls } = fakeHttp(() => ({ bytes }));
	const client = new JoplinClient('http://127.0.0.1:41184', 'TOKEN', http);
	const buf = await client.getResourceFile('abc');
	assert.equal(buf.byteLength, 3);
	assert.equal(calls[0].pathname, '/resources/abc/file');
});

test('discoverJoplin skips closed ports and finds the ping response', async () => {
	const http = async (url) => {
		if (url.includes(':41185/ping')) {
			return { status: 200, json: () => null, text: () => 'JoplinClipperServer\n', arrayBuffer: () => new ArrayBuffer(0) };
		}
		throw new Error('connection refused');
	};
	assert.equal(await discoverJoplin(http), 'http://127.0.0.1:41185');
});

test('discoverJoplin returns null when nothing answers', async () => {
	const http = async () => {
		throw new Error('connection refused');
	};
	assert.equal(await discoverJoplin(http, 41184, 41186), null);
});
