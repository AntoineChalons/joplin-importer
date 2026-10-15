import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFrontmatter, formatDateTime } from '../src/joplin/frontmatter';

const SEOUL = 540;

test('formatDateTime: converts Unix milliseconds to a date and time without a zone', () => {
	assert.equal(formatDateTime(Date.UTC(2026, 9, 15, 0, 0, 0), SEOUL), '2026-10-15T09:00:00');
	assert.equal(formatDateTime(Date.UTC(2026, 0, 2, 3, 4, 5), 0), '2026-01-02T03:04:05');
	assert.equal(formatDateTime(Date.UTC(2026, 9, 15, 20, 0, 0), SEOUL), '2026-10-16T05:00:00');
});

test('buildFrontmatter: a todo with tags, dates, source and author', () => {
	const note = {
		id: 'n1',
		parent_id: 'f1',
		title: 'Plan',
		user_created_time: Date.UTC(2026, 9, 15, 0, 0, 0),
		user_updated_time: Date.UTC(2026, 9, 16, 1, 2, 3),
		source_url: 'https://example.com/a?x=1#y',
		author: 'Me',
		is_todo: 1,
		todo_due: Date.UTC(2026, 9, 20, 12, 0, 0),
		todo_completed: 0,
	};
	const fm = buildFrontmatter(note, { tags: ['people/mike', 'work'], fileStem: 'Plan', utcOffsetMinutes: SEOUL });
	assert.equal(
		fm,
		[
			'---',
			'tags:',
			'  - "people/mike"',
			'  - "work"',
			'created: 2026-10-15T09:00:00',
			'updated: 2026-10-16T10:02:03',
			'source: "https://example.com/a?x=1#y"',
			'author: "Me"',
			'todo: true',
			'due: 2026-10-20T21:00:00',
			'joplin_id: "n1"',
			'---',
			'',
		].join('\n'),
	);
});

test('buildFrontmatter: a completed todo has completed and no due', () => {
	const note = { id: 'n2', parent_id: 'f1', title: 'Done', is_todo: 1, todo_due: 0, todo_completed: Date.UTC(2026, 9, 15, 0, 0, 0) };
	const fm = buildFrontmatter(note, { tags: [], fileStem: 'Done', utcOffsetMinutes: SEOUL });
	assert.equal(fm, '---\ntodo: true\ncompleted: 2026-10-15T09:00:00\njoplin_id: "n2"\n---\n');
});

test('buildFrontmatter: the Joplin title becomes an alias when the file name differs, with quoting', () => {
	const note = { id: 'n3', parent_id: 'f1', title: 'a/b: "q"' };
	const fm = buildFrontmatter(note, { tags: [], fileStem: 'a-b- -q-' });
	assert.equal(fm, '---\naliases:\n  - "a/b: \\"q\\""\njoplin_id: "n3"\n---\n');
});

test('buildFrontmatter: an untitled note has no alias and a minimal block starting on line 1', () => {
	const note = { id: 'n4', parent_id: 'f1', title: '', is_todo: 0, source_url: '  ', author: '' };
	const fm = buildFrontmatter(note, { tags: [], fileStem: 'Untitled' });
	assert.equal(fm, '---\njoplin_id: "n4"\n---\n');
	assert.ok(fm.startsWith('---\n'));
});
