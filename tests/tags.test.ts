import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JoplinClient } from '../src/joplin/client';
import { buildTagMapping, loadNotesByTag, toObsidianTag } from '../src/joplin/tags';
import { fakeHttp } from './fake-http';

test('toObsidianTag: spaces and punctuation become hyphens', () => {
	assert.equal(toObsidianTag('my tag'), 'my-tag');
	assert.equal(toObsidianTag('work: urgent'), 'work-urgent');
	assert.equal(toObsidianTag('C++'), 'C');
	assert.equal(toObsidianTag('#hash'), 'hash');
	assert.equal(toObsidianTag('a/b c'), 'a/b-c');
});

test('toObsidianTag: keeps Unicode letters', () => {
	assert.equal(toObsidianTag('한국어 태그'), '한국어-태그');
	assert.equal(toObsidianTag('café'), 'café');
});

test('toObsidianTag: purely numeric tags get a prefix', () => {
	assert.equal(toObsidianTag('1984'), 'tag-1984');
});

test('toObsidianTag: nothing usable gives null', () => {
	assert.equal(toObsidianTag(''), null);
	assert.equal(toObsidianTag('!!!'), null);
	assert.equal(toObsidianTag('  '), null);
});

test('toObsidianTag: @name person tags go under people/', () => {
	assert.equal(toObsidianTag('@mike'), 'people/mike');
	assert.equal(toObsidianTag('@alicia-lemaire'), 'people/alicia-lemaire');
	assert.equal(toObsidianTag('@Mike Dupont'), 'people/Mike-Dupont');
	assert.equal(toObsidianTag('@@mike'), 'people/mike');
	assert.equal(toObsidianTag('@123'), 'people/123');
	assert.equal(toObsidianTag('@'), null);
	assert.equal(toObsidianTag('@!!!'), null);
});

test('buildTagMapping: merges case variants, reports renamed, invalid and unknown refs', () => {
	const tags = [
		{ id: 't1', title: 'work' },
		{ id: 't2', title: 'Work' },
		{ id: 't3', title: 'my tag' },
		{ id: 't4', title: '!!!' },
		{ id: 't5', title: '1984' },
	];
	const notesByTag = new Map([
		['t1', ['n1', 'n2']],
		['t2', ['n2', 'n3']],
		['t3', ['n1']],
		['t4', ['n1']],
		['t5', ['nX']],
	]);
	const m = buildTagMapping(tags, notesByTag, new Set(['n1', 'n2', 'n3']));

	assert.deepEqual(m.tagsByNoteId.get('n1'), ['my-tag', 'work']);
	assert.deepEqual(m.tagsByNoteId.get('n2'), ['work']);
	assert.deepEqual(m.tagsByNoteId.get('n3'), ['work']);
	assert.equal(m.notesWithTags, 3);
	assert.equal(m.tagNoteLinks, 4);
	assert.deepEqual(m.renamed, [
		{ original: 'my tag', obsidian: 'my-tag' },
		{ original: '1984', obsidian: 'tag-1984' },
	]);
	assert.deepEqual(m.invalid, ['!!!']);
	assert.deepEqual(m.collisions, [{ obsidian: 'work', originals: ['work', 'Work'] }]);
	assert.equal(m.unknownNoteRefs, 1);
	assert.equal(m.tagCount, 5);
});

test('buildTagMapping: @name and an existing people/name tag merge by case', () => {
	const tags = [
		{ id: 't1', title: '@Mike' },
		{ id: 't2', title: 'people/mike' },
	];
	const m = buildTagMapping(
		tags,
		new Map([
			['t1', ['n1']],
			['t2', ['n1']],
		]),
		new Set(['n1']),
	);
	assert.deepEqual(m.tagsByNoteId.get('n1'), ['people/Mike']);
	assert.deepEqual(m.collisions, [{ obsidian: 'people/Mike', originals: ['@Mike', 'people/mike'] }]);
});

test('buildTagMapping: no tags gives an empty mapping', () => {
	const m = buildTagMapping([], new Map(), new Set());
	assert.equal(m.notesWithTags, 0);
	assert.equal(m.tagNoteLinks, 0);
	assert.deepEqual(m.collisions, []);
});

test('loadNotesByTag pages through each tag and keeps results per tag id', async () => {
	const big = Array.from({ length: 120 }, (_, i) => ({ id: `n${i}` }));
	const { http, calls } = fakeHttp((u) => {
		const page = Number(u.searchParams.get('page'));
		const limit = Number(u.searchParams.get('limit'));
		const all = u.pathname === '/tags/t1/notes' ? big : [{ id: 'x1' }];
		const start = (page - 1) * limit;
		return { body: { items: all.slice(start, start + limit), has_more: start + limit < all.length } };
	});
	const client = new JoplinClient('http://127.0.0.1:41184', 'TOKEN', http);
	const progress = [];
	const map = await loadNotesByTag(
		client,
		[
			{ id: 't1', title: 'a' },
			{ id: 't2', title: 'b' },
		],
		(done, total) => progress.push([done, total]),
		2,
	);
	assert.equal(map.get('t1')?.length, 120);
	assert.deepEqual(map.get('t2'), ['x1']);
	assert.deepEqual(progress[progress.length - 1], [2, 2]);
	assert.ok(calls.every((u) => u.searchParams.get('fields') === 'id'));
});
