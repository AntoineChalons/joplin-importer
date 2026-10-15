import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFolders, writeNotes } from '../src/joplin/importer';

const N1 = 'a'.repeat(32);
const N2 = 'b'.repeat(32);
const N3 = 'c'.repeat(32);
const IMG = '1'.repeat(32);
const MISSING = '9'.repeat(32);

function planned(noteId: string, name: string) {
	const folderPath = 'Joplin import/Work';
	return {
		noteId,
		folderPath,
		fileName: `${name}.md`,
		path: `${folderPath}/${name}.md`,
		linkTarget: `${folderPath}/${name}`,
	};
}

const plan = {
	notes: new Map([
		[N1, planned(N1, 'Plan')],
		[N2, planned(N2, 'Other')],
	]),
	foldersToCreate: ['Joplin import', 'Joplin import/Work'],
	report: {} as never,
};

const attachmentPaths = new Map([[IMG, `Joplin import/attachments/${IMG}.jpg`]]);
const tagsByNoteId = new Map([[N1, ['work']]]);

function memorySink(existing: string[] = []) {
	const present = new Set(existing);
	const files = new Map<string, string>();
	const folders: string[] = [];
	const sink = {
		exists: (path: string) => present.has(path) || files.has(path),
		createFolder: async (path: string) => {
			folders.push(path);
			present.add(path);
		},
		createNote: async (path: string, content: string) => {
			if (present.has(path) || files.has(path)) throw new Error('File already exists.');
			files.set(path, content);
		},
	};
	return { sink, files, folders };
}

async function* pages(...list: Record<string, unknown>[][]) {
	for (const page of list) yield page as never;
}

const note1 = { id: N1, parent_id: 'f1', title: 'Plan', body: `See [x](:/${N2})` };
const note2 = { id: N2, parent_id: 'f1', title: 'Other', body: `![](:/${IMG})` };
const note3 = { id: N3, parent_id: 'f1', title: 'Html', body: 'skipped', markup_language: 2 };

test('writeNotes: renders and creates the planned notes, ignores notes that are not in the plan', async () => {
	const { sink, files } = memorySink();
	const report = await writeNotes(pages([note1, note3], [note2]), { plan, tagsByNoteId, attachmentPaths }, sink);

	assert.equal(report.written, 2);
	assert.deepEqual(report.failed, []);
	assert.deepEqual(report.notFound, []);
	assert.deepEqual(report.notesWithLeftover, []);
	assert.equal(files.size, 2);
	assert.equal(
		files.get('Joplin import/Work/Plan.md'),
		`---\ntags:\n  - "work"\njoplin_id: "${N1}"\n---\n\nSee [[Joplin import/Work/Other|x]]\n`,
	);
	assert.equal(
		files.get('Joplin import/Work/Other.md'),
		`---\njoplin_id: "${N2}"\n---\n\n![[Joplin import/attachments/${IMG}.jpg]]\n`,
	);
	assert.equal(report.stats.noteLinks, 1);
	assert.equal(report.stats.embeds, 1);
	assert.equal(report.stats.leftover, 0);
});

test('writeNotes: an existing file is a failure that does not stop the other notes', async () => {
	const { sink, files } = memorySink(['Joplin import/Work/Plan.md']);
	const report = await writeNotes(pages([note1, note2]), { plan, tagsByNoteId, attachmentPaths }, sink);

	assert.equal(report.written, 1);
	assert.deepEqual(report.failed, [{ noteId: N1, message: 'File already exists.' }]);
	assert.ok(files.has('Joplin import/Work/Other.md'));
	assert.equal(files.has('Joplin import/Work/Plan.md'), false);
});

test('writeNotes: planned notes that Joplin did not return are reported', async () => {
	const { sink } = memorySink();
	const report = await writeNotes(pages([note1]), { plan, tagsByNoteId, attachmentPaths }, sink);
	assert.equal(report.written, 1);
	assert.deepEqual(report.notFound, [N2]);
});

test('writeNotes: a reference to a missing target is counted as left over', async () => {
	const { sink } = memorySink();
	const broken = { id: N1, parent_id: 'f1', title: 'Plan', body: `[gone](:/${MISSING})` };
	const report = await writeNotes(pages([broken, note2]), { plan, tagsByNoteId, attachmentPaths }, sink);
	assert.equal(report.stats.notImported, 1);
	assert.equal(report.stats.leftover, 1);
	assert.deepEqual(report.notesWithLeftover, [N1]);
});

test('writeNotes: reports progress', async () => {
	const { sink } = memorySink();
	const seen: number[][] = [];
	await writeNotes(pages([note1], [note2]), { plan, tagsByNoteId, attachmentPaths }, sink, (d, t) => seen.push([d, t]));
	assert.deepEqual(seen, [
		[1, 2],
		[2, 2],
	]);
});

test('createFolders: creates missing folders in order and leaves existing ones', async () => {
	const { sink, folders } = memorySink(['Joplin import']);
	const report = await createFolders(['Joplin import', 'Joplin import/Work'], sink);
	assert.deepEqual(folders, ['Joplin import/Work']);
	assert.equal(report.created, 1);
	assert.equal(report.existing, 1);
	assert.deepEqual(report.failed, []);
});

test('createFolders: a failing folder is reported and the others are still created', async () => {
	const created: string[] = [];
	const sink = {
		exists: () => false,
		createFolder: async (path: string) => {
			if (path === 'a/b') throw new Error('nope');
			created.push(path);
		},
		createNote: async () => undefined,
	};
	const report = await createFolders(['a', 'a/b', 'c'], sink);
	assert.deepEqual(created, ['a', 'c']);
	assert.deepEqual(report.failed, [{ path: 'a/b', message: 'nope' }]);
});
