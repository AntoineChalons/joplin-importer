import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from '../src/joplin/report';

const stats = {
	noteLinks: 1,
	embeds: 1,
	attachmentLinks: 1,
	droppedAliases: 0,
	flattenedImageLinks: 0,
	insideCode: 0,
	notImported: 0,
	leftover: 0,
};

const allTimesKept = { ctimeRequested: 4, ctimeApplied: 4, mtimeRequested: 4, mtimeApplied: 4 };

function input(overrides: Record<string, unknown> = {}) {
	return {
		date: '2026-10-15T23:00:00',
		importFolder: 'Joplin import',
		attachmentFolder: 'Joplin import/attachments',
		inventory: { notebooks: 3, topLevelNotebooks: 2, maxDepth: 1, notes: 5, tags: 2, resources: 2, todos: 0, encryptedNotes: 0, orphanNotes: 0, folderProblems: 0 },
		paths: { totalNotes: 5, planned: 4, skipped: [], unfiled: 0, sanitisedNotes: 1, sanitisedFolders: 0, untitledNotes: 1, truncatedNames: 0, collisionRenamedNotes: 1, collisionRenamedFolders: 0 },
		tags: { tagsByNoteId: new Map(), tagCount: 2, notesWithTags: 3, tagNoteLinks: 4, renamed: [], invalid: [], collisions: [], unknownNoteRefs: 0 },
		referencedAttachments: 2,
		attachments: { requested: 2, written: 2, skippedExisting: 0, bytes: 100, failed: [], sizeMismatches: [], pathById: new Map() },
		folders: { created: 3, existing: 0, failed: [] },
		notes: { written: 4, failed: [], stats, notesWithLeftover: [], notFound: [], times: allTimesKept },
		skipped: [{ id: 'abc', title: 'My [[note]] | x', reason: 'html' }],
		...overrides,
	} as never;
}

test('buildReport: a clean import is OK, lists skipped notes and has no problems', () => {
	const text = buildReport(input());
	assert.ok(text.startsWith('---\ntype: import-report\ncreated: 2026-10-15T23:00:00\n---\n'));
	assert.ok(text.includes('Overall: OK'));
	assert.ok(text.includes('| Notes written plus skipped, against all Joplin notes | 5 | 5 | OK |'));
	assert.ok(text.includes('| Referenced attachments in the vault | 2 | 2 | OK |'));
	assert.ok(text.includes('- html: My --note-- - x (abc)'));
	assert.ok(text.includes('## Problems\nNone.'));
	assert.ok(text.endsWith('\n'));
});

test('buildReport: reports how many file times were kept, with a note when some were lost', () => {
	const kept = buildReport(input());
	assert.ok(kept.includes('- File times from Joplin: creation time kept for 4 of 4 notes, modification time kept for 4 of 4 notes.'));
	assert.equal(kept.includes('Some file times were not kept'), false);

	const lost = buildReport(
		input({
			notes: {
				written: 4,
				failed: [],
				stats,
				notesWithLeftover: [],
				notFound: [],
				times: { ctimeRequested: 4, ctimeApplied: 0, mtimeRequested: 4, mtimeApplied: 4 },
			},
		}),
	);
	assert.ok(lost.includes('creation time kept for 0 of 4 notes, modification time kept for 4 of 4 notes.'));
	assert.ok(lost.includes('- Some file times were not kept; the original dates are always in the `created` and `updated` properties.'));
	assert.ok(lost.includes('Overall: OK'));
});

test('buildReport: failures, a missing note and left-over references need attention', () => {
	const text = buildReport(
		input({
			notes: {
				written: 3,
				failed: [{ noteId: 'n9', message: 'File already exists.' }],
				stats: { ...stats, leftover: 1 },
				notesWithLeftover: ['n8'],
				notFound: ['n7'],
				times: allTimesKept,
			},
		}),
	);
	assert.ok(text.includes('Overall: NEEDS ATTENTION'));
	assert.ok(text.includes('| Notes written plus skipped, against all Joplin notes | 5 | 4 | FAIL |'));
	assert.ok(text.includes('| Notes that failed to write | 0 | 1 | FAIL |'));
	assert.ok(text.includes('- Note n9: File already exists.'));
	assert.ok(text.includes('- Note n7: not returned by Joplin'));
	assert.ok(text.includes('- Note n8: still contains a Joplin reference outside code'));
});

test('buildReport: no skipped notes says None', () => {
	const text = buildReport(input({ skipped: [] }));
	assert.ok(text.includes('## Skipped notes\nNone.'));
});
