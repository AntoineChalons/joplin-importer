import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countIdMentions } from '../src/joplin/references';
import { renderNote } from '../src/joplin/render';
import { rewriteBody } from '../src/joplin/rewrite';

const IMG = '1'.repeat(32);
const PDF = '2'.repeat(32);
const NOTE = '3'.repeat(32);
const MISSING = '4'.repeat(32);

const ctx = {
	noteTargets: new Map([[NOTE, 'Joplin import/Work/Plan']]),
	attachmentPaths: new Map([
		[IMG, `Joplin import/attachments/${IMG}.jpg`],
		[PDF, `Joplin import/attachments/${PDF}.pdf`],
	]),
};

function handled(r: ReturnType<typeof rewriteBody>): number {
	const s = r.stats;
	return s.noteLinks + s.embeds + s.attachmentLinks + s.insideCode + s.leftover;
}

test('rewriteBody: note links, anchors, image embeds and attachment links', () => {
	const body = `See [Plan](:/${NOTE}) and [my plan](:/${NOTE}#goals "t") and ![photo.jpg](:/${IMG}) and [report.pdf](:/${PDF}).`;
	const r = rewriteBody(body, ctx);
	assert.equal(
		r.body,
		`See [[Joplin import/Work/Plan]] and [[Joplin import/Work/Plan#goals|my plan]] and ` +
			`![[Joplin import/attachments/${IMG}.jpg|photo.jpg]] and [[Joplin import/attachments/${PDF}.pdf|report.pdf]].`,
	);
	assert.deepEqual(r.stats, {
		noteLinks: 2,
		embeds: 1,
		attachmentLinks: 1,
		droppedAliases: 0,
		flattenedImageLinks: 0,
		insideCode: 0,
		notImported: 0,
		leftover: 0,
	});
	assert.equal(countIdMentions(body), handled(r));
});

test('rewriteBody: HTML images keep their size', () => {
	const r = rewriteBody(
		[
			`<img src=":/${IMG}" width="300" height="200" alt="x">`,
			`<img alt="a" src=':/${IMG}' width=150>`,
			`<img src=":/${IMG}">`,
		].join('\n'),
		ctx,
	);
	const file = `Joplin import/attachments/${IMG}.jpg`;
	assert.equal(r.body, [`![[${file}|300x200]]`, `![[${file}|150]]`, `![[${file}]]`].join('\n'));
	assert.equal(r.stats.embeds, 3);
	assert.equal(r.stats.leftover, 0);
});

test('rewriteBody: text that would break the link or be read as a size is dropped', () => {
	const file = `Joplin import/attachments/${IMG}.jpg`;
	const r = rewriteBody(
		[`[a|b](:/${NOTE})`, `![200](:/${IMG})`, `![800x600](:/${IMG})`, `[](:/${NOTE})`].join('\n'),
		ctx,
	);
	assert.equal(
		r.body,
		['[[Joplin import/Work/Plan]]', `![[${file}]]`, `![[${file}]]`, '[[Joplin import/Work/Plan]]'].join('\n'),
	);
	assert.equal(r.stats.droppedAliases, 3);
});

test('rewriteBody: unknown targets are left as written and counted', () => {
	const body = `[x](:/${MISSING}) and <img src=":/${MISSING}">`;
	const r = rewriteBody(body, ctx);
	assert.equal(r.body, body);
	assert.equal(r.stats.notImported, 2);
	assert.equal(r.stats.leftover, 2);
	assert.equal(countIdMentions(body), handled(r));
});

test('rewriteBody: fenced code and inline code are not rewritten', () => {
	const body = [
		`Before [a](:/${NOTE})`,
		'```md',
		`[b](:/${NOTE})`,
		'```',
		`After \`[c](:/${NOTE})\` and [d](:/${NOTE})`,
		'',
	].join('\n');
	const r = rewriteBody(body, ctx);
	assert.equal(
		r.body,
		[
			'Before [[Joplin import/Work/Plan|a]]',
			'```md',
			`[b](:/${NOTE})`,
			'```',
			`After \`[c](:/${NOTE})\` and [[Joplin import/Work/Plan|d]]`,
			'',
		].join('\n'),
	);
	assert.equal(r.stats.insideCode, 2);
	assert.equal(r.stats.noteLinks, 2);
	assert.equal(r.stats.leftover, 0);
	assert.equal(countIdMentions(body), handled(r));
});

test('rewriteBody: an unclosed fence runs to the end of the note', () => {
	const r = rewriteBody(['```', `[x](:/${NOTE})`].join('\n'), ctx);
	assert.equal(r.stats.insideCode, 1);
	assert.equal(r.stats.noteLinks, 0);
});

test('rewriteBody: an image inside a link becomes an embed followed by a link', () => {
	const r = rewriteBody(`[![alt](:/${IMG})](:/${NOTE})`, ctx);
	assert.equal(r.body, `![[Joplin import/attachments/${IMG}.jpg|alt]] [[Joplin import/Work/Plan]]`);
	assert.equal(r.stats.flattenedImageLinks, 1);
	assert.equal(r.stats.embeds, 1);
	assert.equal(r.stats.noteLinks, 1);
	assert.equal(r.stats.leftover, 0);
});

test('rewriteBody: CRLF line endings are kept', () => {
	const r = rewriteBody(`a\r\n[x](:/${NOTE})\r\n`, ctx);
	assert.equal(r.body, 'a\r\n[[Joplin import/Work/Plan|x]]\r\n');
});

test('renderNote: frontmatter, blank line, rewritten body and a final newline', () => {
	const note = { id: 'n1', parent_id: 'f1', title: 'Plan', body: `Link [t](:/${NOTE})` };
	const { content, stats } = renderNote(note, { ...ctx, tags: ['work'], fileStem: 'Plan' });
	assert.equal(
		content,
		'---\ntags:\n  - "work"\njoplin_id: "n1"\n---\n\nLink [[Joplin import/Work/Plan|t]]\n',
	);
	assert.equal(stats.noteLinks, 1);
	assert.ok(content.startsWith('---\n'));
});

test('renderNote: an empty body gives only the frontmatter and a blank line', () => {
	const { content } = renderNote({ id: 'n2', parent_id: 'f1', title: 'T' }, { ...ctx, tags: [], fileStem: 'T' });
	assert.equal(content, '---\njoplin_id: "n2"\n---\n\n');
});
