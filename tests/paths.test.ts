import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFolderIndex } from '../src/joplin/folders';
import { planNotePaths, sanitiseName } from '../src/joplin/paths';

const ID_A = 'a1'.repeat(16);
const ID_B = 'b2'.repeat(16);
const ID_C = 'c3'.repeat(16);
const ID_D = 'd4'.repeat(16);

function note(id: string, parent: string, title: string, extra: Record<string, unknown> = {}) {
	return { id, parent_id: parent, title, user_created_time: 1000, ...extra };
}

const folders = [
	{ id: 'f1', title: 'Work' },
	{ id: 'f2', parent_id: 'f1', title: 'Projects' },
	{ id: 'f3', title: 'Home' },
	{ id: 'f4', parent_id: 'f3', title: 'Projects' },
	{ id: 'f5', title: 'Empty' },
	{ id: 'f6', title: 'attachments' },
	{ id: 'f7', title: 'work' },
];

test('sanitiseName: replaces characters that break files, notes also lose link characters', () => {
	assert.equal(sanitiseName('a/b:c', 'folder').name, 'a-b-c');
	assert.equal(sanitiseName('Plan #1', 'folder').name, 'Plan #1');
	assert.equal(sanitiseName('Plan #1 [draft] ^x', 'note').name, 'Plan -1 -draft- -x');
	assert.equal(sanitiseName('  ..hidden.. ', 'note').name, 'hidden');
});

test('sanitiseName: empty names, Windows reserved names and Unicode normalisation', () => {
	assert.deepEqual(sanitiseName('', 'note'), { name: 'Untitled', changed: false, untitled: true, truncated: false });
	assert.equal(sanitiseName('   ', 'folder').name, 'Untitled');
	assert.equal(sanitiseName('CON', 'note').name, 'CON_');
	assert.equal(sanitiseName('nul.txt', 'folder').name, 'nul.txt_');
	const nfc = sanitiseName('cafe\u0301', 'note');
	assert.equal(nfc.name, 'caf\u00e9');
	assert.equal(nfc.changed, true);
});

test('sanitiseName: limits a name to 200 UTF-8 bytes without cutting a character', () => {
	const r = sanitiseName('\ud55c'.repeat(100), 'note');
	assert.equal(r.name, '\ud55c'.repeat(66));
	assert.equal(r.truncated, true);
	assert.ok(new TextEncoder().encode(r.name).length <= 200);
});

test('planNotePaths: builds paths under Joplin import and creates only folders that hold notes', () => {
	const index = buildFolderIndex(folders);
	const plan = planNotePaths(index, [note('n1', 'f2', 'Meeting'), note('n2', 'f4', 'Meeting')]);

	assert.equal(plan.notes.get('n1')?.path, 'Joplin import/Work/Projects/Meeting.md');
	assert.equal(plan.notes.get('n1')?.linkTarget, 'Joplin import/Work/Projects/Meeting');
	assert.equal(plan.notes.get('n2')?.path, 'Joplin import/Home/Projects/Meeting.md');
	assert.deepEqual(plan.foldersToCreate, [
		'Joplin import',
		'Joplin import/Home',
		'Joplin import/Work',
		'Joplin import/Home/Projects',
		'Joplin import/Work/Projects',
	]);
	assert.equal(plan.report.planned, 2);
	assert.equal(plan.report.totalNotes, 2);
});

test('planNotePaths: uses a custom import folder', () => {
	const plan = planNotePaths(buildFolderIndex(folders), [note('n1', 'f1', 'X')], { importFolder: '/Imported/Joplin/' });
	assert.equal(plan.notes.get('n1')?.path, 'Imported/Joplin/Work/X.md');
});

test('planNotePaths: same-name notes keep the clean name for the earliest, others get an id suffix', () => {
	const index = buildFolderIndex(folders);
	const base = [
		note(ID_A, 'f1', 'Plan', { user_created_time: 100 }),
		note(ID_B, 'f1', 'Plan', { user_created_time: 50 }),
		note(ID_C, 'f1', 'Plan', { user_created_time: 100 }),
	];
	const plan = planNotePaths(index, base);
	assert.equal(plan.notes.get(ID_B)?.fileName, 'Plan.md');
	assert.equal(plan.notes.get(ID_A)?.fileName, 'Plan a1a1a1a1.md');
	assert.equal(plan.notes.get(ID_C)?.fileName, 'Plan c3c3c3c3.md');
	assert.equal(plan.report.collisionRenamedNotes, 2);

	const later = planNotePaths(index, [...base, note(ID_D, 'f1', 'plan', { user_created_time: 300 })]);
	assert.equal(later.notes.get(ID_D)?.fileName, 'plan d4d4d4d4.md');
	for (const id of [ID_A, ID_B, ID_C]) {
		assert.equal(later.notes.get(id)?.fileName, plan.notes.get(id)?.fileName);
	}
});

test('planNotePaths: empty titles and cleaned titles are counted', () => {
	const plan = planNotePaths(buildFolderIndex(folders), [
		note(ID_A, 'f1', ''),
		note(ID_B, 'f1', ''),
		note(ID_C, 'f1', 'a/b'),
	]);
	assert.equal(plan.notes.get(ID_A)?.fileName, 'Untitled.md');
	assert.equal(plan.notes.get(ID_B)?.fileName, 'Untitled b2b2b2b2.md');
	assert.equal(plan.notes.get(ID_C)?.fileName, 'a-b.md');
	assert.equal(plan.report.untitledNotes, 2);
	assert.equal(plan.report.sanitisedNotes, 1);
});

test('planNotePaths: skips HTML and encrypted notes and puts unknown-notebook notes in Unfiled', () => {
	const plan = planNotePaths(buildFolderIndex(folders), [
		note('n1', 'f1', 'Fine'),
		note('n2', 'f1', 'Html', { markup_language: 2 }),
		note('n3', 'f1', 'Secret', { encryption_applied: 1 }),
		note('n4', 'zzz', 'Orphan'),
	]);
	assert.deepEqual(plan.report.skipped, [
		{ noteId: 'n2', reason: 'html' },
		{ noteId: 'n3', reason: 'encrypted' },
	]);
	assert.equal(plan.notes.get('n4')?.path, 'Joplin import/Unfiled/Orphan.md');
	assert.equal(plan.report.unfiled, 1);
	assert.equal(plan.report.planned + plan.report.skipped.length, plan.report.totalNotes);
	assert.equal(plan.notes.has('n2'), false);
});

test('planNotePaths: sibling notebooks that differ only by case or use a reserved name get an id suffix', () => {
	const plan = planNotePaths(buildFolderIndex(folders), [
		note('n1', 'f1', 'A'),
		note('n2', 'f7', 'B'),
		note('n3', 'f6', 'C'),
	]);
	assert.equal(plan.notes.get('n1')?.path, 'Joplin import/Work/A.md');
	assert.equal(plan.notes.get('n2')?.path, 'Joplin import/work f7/B.md');
	assert.equal(plan.notes.get('n3')?.path, 'Joplin import/attachments f6/C.md');
	assert.equal(plan.report.collisionRenamedFolders, 2);
});

test('planNotePaths: a notebook cycle does not loop forever', () => {
	const cyc = buildFolderIndex([
		{ id: 'fa', parent_id: 'fb', title: 'A' },
		{ id: 'fb', parent_id: 'fa', title: 'B' },
	]);
	const plan = planNotePaths(cyc, [note('n1', 'fa', 'Note'), note('n2', 'fb', 'Other')]);
	assert.equal(plan.notes.get('n1')?.path, 'Joplin import/B/A/Note.md');
	assert.equal(plan.notes.get('n2')?.path, 'Joplin import/B/Other.md');
});
