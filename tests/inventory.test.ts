import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JoplinClient } from '../src/joplin/client';
import { loadInventory } from '../src/joplin/inventory';
import { fakeHttp } from './fake-http';

const data = {
	'/folders': [
		{ id: 'A', parent_id: '', title: 'Root' },
		{ id: 'B', parent_id: 'A', title: 'Child' },
	],
	'/notes': [
		{ id: 'n1', parent_id: 'B', title: 'one', is_todo: 0, encryption_applied: 0 },
		{ id: 'n2', parent_id: 'ZZZ', title: 'orphan', is_todo: 0, encryption_applied: 0 },
		{ id: 'n3', parent_id: 'A', title: 'todo', is_todo: 1, encryption_applied: 1 },
	],
	'/tags': [{ id: 't1', title: 'x' }],
	'/resources': [{ id: 'r1', mime: 'image/jpeg', filename: '', size: 10 }],
};

test('loadInventory gathers all four collections and a summary', async () => {
	const { http } = fakeHttp((u) => ({ body: { items: data[u.pathname], has_more: false } }));
	const client = new JoplinClient('http://127.0.0.1:41184', 'TOKEN', http);
	const events = [];
	const inv = await loadInventory(client, (stage, loaded) => events.push({ stage, loaded }));

	assert.deepEqual(inv.summary, {
		notebooks: 2,
		topLevelNotebooks: 1,
		maxDepth: 1,
		notes: 3,
		tags: 1,
		resources: 1,
		todos: 1,
		encryptedNotes: 1,
		orphanNotes: 1,
		folderProblems: 0,
	});
	assert.ok(inv.noteIds.has('n1'));
	assert.ok(inv.resourceIds.has('r1'));
	assert.ok(events.some((e) => e.stage === 'notes' && e.loaded === 3));
	assert.ok(events.some((e) => e.stage === 'attachments' && e.loaded === 1));
});

test('loadInventory handles an empty library', async () => {
	const { http } = fakeHttp(() => ({ body: { items: [], has_more: false } }));
	const client = new JoplinClient('http://127.0.0.1:41184', 'TOKEN', http);
	const inv = await loadInventory(client);
	assert.equal(inv.summary.notes, 0);
	assert.equal(inv.summary.notebooks, 0);
	assert.equal(inv.summary.maxDepth, 0);
});
