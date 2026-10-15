import { countIdMentions } from './references';

export interface RewriteContext {
	/** Joplin note id to the vault path of the imported note, without extension. */
	noteTargets: ReadonlyMap<string, string>;
	/** Joplin attachment id to the vault path (with extension) of a file that is in the vault. */
	attachmentPaths: ReadonlyMap<string, string>;
}

export interface RewriteStats {
	/** `[text](:/id)` to a note, now a wikilink. */
	noteLinks: number;
	/** Images and attachments now embedded with `![[...]]`. */
	embeds: number;
	/** `[name](:/id)` to an attachment, now a wikilink to the file. */
	attachmentLinks: number;
	/** Alt text or link text left out because it would break the wikilink or be read as a size. */
	droppedAliases: number;
	/** `[![alt](:/img)](:/target)` split into an embed followed by a link. */
	flattenedImageLinks: number;
	/** `:/id` mentions inside code, left as written. */
	insideCode: number;
	/** References whose target is not in the vault (not imported or download failed), left as written. */
	notImported: number;
	/** `:/id` mentions still present outside code after rewriting. Must be 0 for a clean note. */
	leftover: number;
}

export interface RewriteResult {
	body: string;
	stats: RewriteStats;
}

// Markdown: ![alt](:/id) or [text](:/id), optionally with #anchor and/or "title".
const MD_REF = /(!?)\[([^\]]*)\]\(:\/([0-9a-f]{32})(?:#([^)\s"]*))?(?:\s+"[^"]*")?\)/g;
// A link whose text is one image: [![alt](:/img)](:/target)
const IMAGE_LINK = /\[(!\[[^\]]*\]\(:\/[0-9a-f]{32}\))\]\(:\/([0-9a-f]{32})(?:#[^)\s"]*)?(?:\s+"[^"]*")?\)/g;
// HTML: <img src=":/id" ...>
const HTML_IMG = /<img\b[^>]*?\bsrc=["']:\/([0-9a-f]{32})["'][^>]*>/gi;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;
const INLINE_CODE = /(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)/g;
const UNSAFE_TEXT = /[[\]|\r\n]/;

interface Segment {
	text: string;
	code: boolean;
}

function splitInline(text: string): Segment[] {
	const out: Segment[] = [];
	let last = 0;
	for (const m of text.matchAll(INLINE_CODE)) {
		const start = m.index ?? 0;
		if (start > last) out.push({ text: text.slice(last, start), code: false });
		out.push({ text: m[0], code: true });
		last = start + m[0].length;
	}
	if (last < text.length) out.push({ text: text.slice(last), code: false });
	return out;
}

/** Split a note body into code (fenced blocks and inline code) and plain text. */
function splitSegments(body: string): Segment[] {
	const segments: Segment[] = [];
	const lines = body.match(/[^\n]*\n|[^\n]+$/g) ?? [];
	let fence: { char: string; length: number } | null = null;
	let plain = '';

	const flush = (): void => {
		if (plain !== '') {
			segments.push(...splitInline(plain));
			plain = '';
		}
	};

	for (const line of lines) {
		if (fence) {
			segments.push({ text: line, code: true });
			const close = FENCE_CLOSE.exec(line);
			const run = close?.[1] ?? '';
			if (run !== '' && run.charAt(0) === fence.char && run.length >= fence.length) fence = null;
			continue;
		}
		const open = FENCE_OPEN.exec(line);
		if (open) {
			flush();
			const run = open[1] ?? '';
			fence = { char: run.charAt(0), length: run.length };
			segments.push({ text: line, code: true });
			continue;
		}
		plain += line;
	}
	flush();
	return segments;
}

function lastSegment(path: string): string {
	const i = path.lastIndexOf('/');
	return i === -1 ? path : path.slice(i + 1);
}

function wikilink(target: string, anchor: string | undefined, label: string, stats: RewriteStats): string {
	const cleanAnchor = (anchor ?? '').replace(/[[\]|]/g, '');
	const base = cleanAnchor === '' ? target : `${target}#${cleanAnchor}`;
	const alias = label.trim();
	if (alias === '' || alias === lastSegment(target)) return `[[${base}]]`;
	if (UNSAFE_TEXT.test(alias)) {
		stats.droppedAliases++;
		return `[[${base}]]`;
	}
	return `[[${base}|${alias}]]`;
}

function embed(target: string, alt: string, stats: RewriteStats): string {
	const text = alt.trim();
	if (text === '') return `![[${target}]]`;
	// A bare number or NxN would be read by Obsidian as an image size.
	if (/^\d+(x\d+)?$/i.test(text) || UNSAFE_TEXT.test(text)) {
		stats.droppedAliases++;
		return `![[${target}]]`;
	}
	return `![[${target}|${text}]]`;
}

function rewriteMarkdownRef(
	match: string,
	bang: string,
	label: string,
	id: string,
	anchor: string | undefined,
	ctx: RewriteContext,
	stats: RewriteStats,
): string {
	const file = ctx.attachmentPaths.get(id);
	const note = ctx.noteTargets.get(id);
	if (bang === '!') {
		if (file !== undefined) {
			stats.embeds++;
			return embed(file, label, stats);
		}
		if (note !== undefined) {
			stats.embeds++;
			return `![[${note}]]`;
		}
	} else {
		if (note !== undefined) {
			stats.noteLinks++;
			return wikilink(note, anchor, label, stats);
		}
		if (file !== undefined) {
			stats.attachmentLinks++;
			return wikilink(file, undefined, label, stats);
		}
	}
	stats.notImported++;
	return match;
}

function rewriteHtmlImage(match: string, id: string, ctx: RewriteContext, stats: RewriteStats): string {
	const file = ctx.attachmentPaths.get(id);
	if (file === undefined) {
		stats.notImported++;
		return match;
	}
	const width = /\bwidth\s*=\s*["']?(\d+)/i.exec(match)?.[1];
	const height = /\bheight\s*=\s*["']?(\d+)/i.exec(match)?.[1];
	let size = '';
	if (width && height) size = `|${width}x${height}`;
	else if (width) size = `|${width}`;
	stats.embeds++;
	return `![[${file}${size}]]`;
}

/**
 * Rewrite Joplin references in a note body: note links and attachment links become wikilinks,
 * images become embeds. Code is left alone. The result reports what was rewritten and what is
 * left, so the caller can verify that no `:/id` mention remains outside code.
 */
export function rewriteBody(body: string, ctx: RewriteContext): RewriteResult {
	const stats: RewriteStats = {
		noteLinks: 0,
		embeds: 0,
		attachmentLinks: 0,
		droppedAliases: 0,
		flattenedImageLinks: 0,
		insideCode: 0,
		notImported: 0,
		leftover: 0,
	};

	const parts: string[] = [];
	for (const segment of splitSegments(body)) {
		if (segment.code) {
			stats.insideCode += countIdMentions(segment.text);
			parts.push(segment.text);
			continue;
		}
		let text = segment.text.replace(IMAGE_LINK, (_m: string, image: string, target: string) => {
			stats.flattenedImageLinks++;
			return `${image} [](:/${target})`;
		});
		text = text.replace(
			MD_REF,
			(match: string, bang: string, label: string, id: string, anchor: string | undefined) =>
				rewriteMarkdownRef(match, bang, label, id, anchor, ctx, stats),
		);
		text = text.replace(HTML_IMG, (match: string, id: string) => rewriteHtmlImage(match, id, ctx, stats));
		stats.leftover += countIdMentions(text);
		parts.push(text);
	}
	return { body: parts.join(''), stats };
}
