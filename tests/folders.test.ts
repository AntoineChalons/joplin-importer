import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFolderIndex, pathFor } from '../src/joplin/folders';

test('flat list: builds three-level paths from parent_id', () => {
	const index = buildFolderIndex([
		{ id: 'c', parent_id: 'b', title: 'C' },
		{ id: 'a', parent_id: '', title: 'A' },
		{ id: 'b', parent_id: 'a', title: 'B' },
	]);
	assert.deepEqual(pathFor(index, 'c'), ['A', 'B', 'C']);
	assert.equal(index.byId.get('c')?.depth, 2);
	assert.deepEqual(index.roots, ['a']);
	assert.equal(index.problems.length, 0);
});

test('tree: children without parent_id inherit their parent', () => {
	const index = buildFolderIndex([
		{ id: 'a', title: 'A', children: [{ id: 'b', title: 'B', children: [{ id: 'c', title: 'C' }] }] },
	]);
	assert.deepEqual(pathFor(index, 'c'), ['A', 'B', 'C']);
	assert.deepEqual(index.roots, ['a']);
});

test('duplicate ids from a mixed flat and tree input are merged', () => {
	const index = buildFolderIndex([
		{ id: 'a', parent_id: '', title: 'A', children: [{ id: 'b', parent_id: 'a', title: 'B' }] },
		{ id: 'b', parent_id: 'a', title: 'B' },
	]);
	assert.equal(index.byId.size, 2);
});

test('missing parent is reported and the folder is treated as a root', () => {
	const index = buildFolderIndex([{ id: 'x', parent_id: 'gone', title: 'X' }]);
	assert.equal(index.problems.length, 1);
	assert.equal(index.problems[0]?.kind, 'missing-parent');
	assert.deepEqual(index.roots, ['x']);
	assert.deepEqual(pathFor(index, 'x'), ['X']);
});

test('cycle is reported and does not hang', () => {
	const index = buildFolderIndex([
		{ id: 'a', parent_id: 'b', title: 'A' },
		{ id: 'b', parent_id: 'a', title: 'B' },
	]);
	assert.ok(index.problems.length > 0);
	assert.ok(index.problems.every((p) => p.kind === 'cycle'));
});

test('pathFor returns an empty array for unknown ids', () => {
	const index = buildFolderIndex([]);
	assert.deepEqual(pathFor(index, 'nope'), []);
});
