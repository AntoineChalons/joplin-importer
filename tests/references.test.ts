import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReferenceCollector, countIdMentions, scanReferences } from '../src/joplin/references';

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);
const C = 'c'.repeat(32);
const D = 'd'.repeat(32);

test('image embed is found with its alt text', () => {
	assert.deepEqual(scanReferences(`![pic](:/${A})`), [{ kind: 'image', id: A, text: 'pic' }]);
});

test('link is found with its text', () => {
	assert.deepEqual(scanReferences(`[other note](:/${B})`), [{ kind: 'link', id: B, text: 'other note' }]);
});

test('link with anchor and title is still a link to the id', () => {
	const refs = scanReferences(`[n](:/${B}#section "Title")`);
	assert.equal(refs.length, 1);
	assert.equal(refs[0]?.id, B);
	assert.equal(refs[0]?.kind, 'link');
});

test('HTML img tag is found as an image', () => {
	assert.deepEqual(scanReferences(`<img src=":/${C}" alt="x">`), [{ kind: 'image', id: C, text: '' }]);
});

test('ordinary links, short ids and local images are ignored', () => {
	const body = '[x](https://example.com) and :/short and ![y](./local.png)';
	assert.deepEqual(scanReferences(body), []);
	assert.equal(countIdMentions(body), 0);
});

test('several references in one body are all found', () => {
	const refs = scanReferences(`[a](:/${B}) text ![b](:/${A})`);
	assert.equal(refs.length, 2);
	assert.deepEqual(refs.map((r) => r.id).sort(), [A, B]);
});

test('collector classifies references and reports problems', () => {
	const c = new ReferenceCollector(new Set([B]), new Set([A, D]));
	c.addNote('n1', `![pic](:/${A}) and [other](:/${B})`);
	c.addNote('n2', `[ghost](:/${C})`);
	c.addNote('n3', `see :/${D} bare`);
	c.addNote('n4', 'plain text');

	const r = c.report();
	assert.equal(r.notesScanned, 4);
	assert.equal(r.notesWithReferences, 2);
	assert.equal(r.totalReferences, 3);
	assert.equal(r.imageToResource, 1);
	assert.equal(r.linkToNote, 1);
	assert.equal(r.linkToResource, 0);
	assert.deepEqual(r.unresolved, [{ noteId: 'n2', id: C, kind: 'link' }]);
	assert.equal(r.unparsedMentions, 1);
	assert.deepEqual(r.notesWithUnparsedMentions, ['n3']);
	assert.deepEqual(r.referencedResourceIds, [A]);
	assert.deepEqual(r.unreferencedResourceIds, [D]);
});

test('nested image-in-link leaves the outer link as an unparsed mention', () => {
	const c = new ReferenceCollector(new Set([B]), new Set([A]));
	c.addNote('n1', `[![alt](:/${A})](:/${B})`);
	const r = c.report();
	assert.equal(r.totalReferences, 1);
	assert.equal(r.unparsedMentions, 1);
});
