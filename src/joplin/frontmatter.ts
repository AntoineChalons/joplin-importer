import type { JoplinNote } from './models';

export interface FrontmatterOptions {
	/** Obsidian tags of the note (already converted, without `#`). */
	tags: readonly string[];
	/** Vault file name without extension; the Joplin title becomes an alias when it differs. */
	fileStem: string;
	/** Minutes east of UTC. When omitted, the local time of the machine is used. */
	utcOffsetMinutes?: number;
}

function pad(n: number, width = 2): string {
	return String(n).padStart(width, '0');
}

/** Format a Unix time in milliseconds as `YYYY-MM-DDTHH:MM:SS` (Obsidian date and time, no zone). */
export function formatDateTime(ms: number, utcOffsetMinutes?: number): string {
	if (utcOffsetMinutes === undefined) {
		const d = new Date(ms);
		return (
			`${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
			`T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
		);
	}
	const d = new Date(ms + utcOffsetMinutes * 60000);
	return (
		`${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
		`T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
	);
}

/** Double-quoted YAML string (JSON strings are valid YAML), safe for colons, quotes and `#`. */
function quote(value: string): string {
	return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function isTime(value: number | undefined): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** YAML frontmatter block for a note, ending with the closing `---` line and a newline. */
export function buildFrontmatter(note: JoplinNote, options: FrontmatterOptions): string {
	const lines: string[] = [];
	const time = (ms: number): string => formatDateTime(ms, options.utcOffsetMinutes);

	const title = (note.title ?? '').trim();
	if (title !== '' && title !== options.fileStem) {
		lines.push('aliases:', `  - ${quote(title)}`);
	}
	if (options.tags.length > 0) {
		lines.push('tags:');
		for (const tag of options.tags) lines.push(`  - ${quote(tag)}`);
	}
	if (isTime(note.user_created_time)) lines.push(`created: ${time(note.user_created_time)}`);
	if (isTime(note.user_updated_time)) lines.push(`updated: ${time(note.user_updated_time)}`);

	const source = (note.source_url ?? '').trim();
	if (source !== '') lines.push(`source: ${quote(source)}`);
	const author = (note.author ?? '').trim();
	if (author !== '') lines.push(`author: ${quote(author)}`);

	if (note.is_todo) {
		lines.push('todo: true');
		if (isTime(note.todo_due)) lines.push(`due: ${time(note.todo_due)}`);
		if (isTime(note.todo_completed)) lines.push(`completed: ${time(note.todo_completed)}`);
	}

	lines.push(`joplin_id: ${quote(note.id)}`);
	return `---\n${lines.join('\n')}\n---\n`;
}
