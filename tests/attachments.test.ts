import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JoplinClient } from '../src/joplin/client';
import {
	downloadAttachments,
	extensionFor,
	planAttachmentNames,
	sanitiseFileStem,
} from '../src/joplin/attachments';
import { fakeHttp } from './fake-http';

const ID_A = 'a'.repeat(32);
const ID_B = 'b'.repeat(32);
const FOLDER = 'Joplin import/attachments';

function bytes(n: number): ArrayBuffer {
	return new Uint8Array(n).fill(7).buffer;
}

function memorySink(existing: string[] = []) {
	const present = new Set(existing);
	const written = new Map<string, number>();
	const sink = {
		exists: (path: string) => present.has(path),
		write: async (path: string, data: ArrayBuffer) => {
			written.set(path, data.byteLength);
		},
	};
	return { sink, written };
}

const fixtures = [
	{ id: ID_A, mime: 'image/jpeg', filename: '', file_extension: '', size: 26 },
	{ id: ID_B, mime: 'application/pdf', filename: '', file_extension: '', size: 40 },
];

test('extensionFor: Joplin extension first, then mime type, then bin', () => {
	assert.equal(extensionFor({ id: 'x', file_extension: 'jpg' }), 'jpg');
	assert.equal(extensionFor({ id: 'x', file_extension: '.PNG' }), 'png');
	assert.equal(extensionFor({ id: 'x', file_extension: '', mime: 'image/jpeg' }), 'jpg');
	assert.equal(extensionFor({ id: 'x', file_extension: '', mime: 'application/pdf' }), 'pdf');
	assert.equal(extensionFor({ id: 'x', mime: 'text/plain; charset=utf-8' }), 'txt');
	assert.equal(extensionFor({ id: 'x', mime: 'application/x-unknown' }), 'bin');
	assert.equal(extensionFor({ id: 'x' }), 'bin');
});

test('sanitiseFileStem: removes characters that break files or links', () => {
	assert.equal(sanitiseFileStem('a/b:c#d'), 'a-b-c-d');
	assert.equal(sanitiseFileStem('  my  scan  '), 'my scan');
	assert.equal(sanitiseFileStem('...'), '');
});

test('planAttachmentNames: empty filename falls back to id plus extension', () => {
	const names = planAttachmentNames(fixtures);
	assert.equal(names.get(ID_A), `${ID_A}.jpg`);
	assert.equal(names.get(ID_B), `${ID_B}.pdf`);
});

test('planAttachmentNames: keeps the original name and handles collisions in id order', () => {
	const id1 = '1'.repeat(32);
	const id2 = '2'.repeat(32);
	const id3 = '3'.repeat(32);
	const names = planAttachmentNames([
		{ id: id2, filename: 'Scan.pdf', file_extension: 'pdf' },
		{ id: id1, filename: 'scan.pdf', file_extension: 'pdf' },
		{ id: id3, filename: 'a/b:c#d.png', file_extension: 'png' },
	]);
	assert.equal(names.get(id1), 'scan.pdf');
	assert.equal(names.get(id2), 'Scan-22222222.pdf');
	assert.equal(names.get(id3), 'a-b-c-d.png');
});

test('downloadAttachments: downloads only wanted attachments and records paths', async () => {
	const { http, calls } = fakeHttp((u) => {
		if (u.pathname === `/resources/${ID_A}/file`) return { bytes: bytes(26) };
		return { status: 404, body: { error: 'Not found' } };
	});
	const client = new JoplinClient('http://127.0.0.1:41184', 'TOKEN', http);
	const { sink, written } = memorySink();

	const report = await downloadAttachments(client, fixtures, new Set([ID_A]), sink, FOLDER);

	assert.equal(report.requested, 1);
	assert.equal(report.written, 1);
	assert.equal(report.bytes, 26);
	assert.deepEqual(report.failed, []);
	assert.deepEqual(report.sizeMismatches, []);
	assert.equal(written.get(`${FOLDER}/${ID_A}.jpg`), 26);
	assert.equal(report.pathById.get(ID_A), `${FOLDER}/${ID_A}.jpg`);
	assert.equal(calls.filter((u) => u.pathname.endsWith('/file')).length, 1);
});

test('downloadAttachments: skips files already in the vault without downloading', async () => {
	const { http, calls } = fakeHttp(() => ({ bytes: bytes(26) }));
	const client = new JoplinClient('http://127.0.0.1:41184', 'TOKEN', http);
	const existing = `${FOLDER}/${ID_A}.jpg`;
	const { sink, written } = memorySink([existing]);

	const report = await downloadAttachments(client, fixtures, new Set([ID_A]), sink, FOLDER);

	assert.equal(report.skippedExisting, 1);
	assert.equal(report.written, 0);
	assert.equal(written.size, 0);
	assert.equal(calls.length, 0);
	assert.equal(report.pathById.get(ID_A), existing);
});

test('downloadAttachments: one failure does not stop the others and the token is not leaked', async () => {
	const { http } = fakeHttp((u) => {
		if (u.pathname === `/resources/${ID_A}/file`) return { status: 404, body: { error: 'Not found' } };
		return { bytes: bytes(40) };
	});
	const client = new JoplinClient('http://127.0.0.1:41184', 'TOKEN', http);
	const { sink, written } = memorySink();

	const report = await downloadAttachments(client, fixtures, new Set([ID_A, ID_B]), sink, FOLDER);

	assert.equal(report.written, 1);
	assert.equal(written.get(`${FOLDER}/${ID_B}.pdf`), 40);
	assert.equal(report.failed.length, 1);
	assert.equal(report.failed[0]?.id, ID_A);
	assert.match(report.failed[0]?.message ?? '', /404/);
	assert.ok(!(report.failed[0]?.message ?? '').includes('TOKEN'));
});

test('downloadAttachments: an empty response is a failure, a size difference is reported', async () => {
	const { http } = fakeHttp((u) => {
		if (u.pathname === `/resources/${ID_A}/file`) return { bytes: new ArrayBuffer(0) };
		return { bytes: bytes(10) };
	});
	const client = new JoplinClient('http://127.0.0.1:41184', 'TOKEN', http);
	const { sink, written } = memorySink();

	const report = await downloadAttachments(client, fixtures, new Set([ID_A, ID_B]), sink, FOLDER);

	assert.deepEqual(report.failed, [{ id: ID_A, message: 'empty response' }]);
	assert.equal(written.has(`${FOLDER}/${ID_A}.jpg`), false);
	assert.deepEqual(report.sizeMismatches, [{ id: ID_B, expected: 40, actual: 10 }]);
	assert.equal(written.get(`${FOLDER}/${ID_B}.pdf`), 10);
});

test('downloadAttachments: a wanted id that Joplin does not list is reported', async () => {
	const { http } = fakeHttp(() => ({ bytes: bytes(26) }));
	const client = new JoplinClient('http://127.0.0.1:41184', 'TOKEN', http);
	const { sink } = memorySink();
	const missing = 'c'.repeat(32);

	const report = await downloadAttachments(client, fixtures, new Set([missing]), sink, FOLDER);

	assert.equal(report.written, 0);
	assert.deepEqual(report.failed, [{ id: missing, message: 'not in the Joplin attachment list' }]);
});
