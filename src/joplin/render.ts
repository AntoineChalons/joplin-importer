import { buildFrontmatter } from './frontmatter';
import type { FrontmatterOptions } from './frontmatter';
import type { JoplinNote } from './models';
import { rewriteBody } from './rewrite';
import type { RewriteContext, RewriteStats } from './rewrite';

export type RenderContext = RewriteContext & FrontmatterOptions;

/** The text of one imported note: frontmatter, a blank line, then the rewritten body. */
export function renderNote(note: JoplinNote, ctx: RenderContext): { content: string; stats: RewriteStats } {
	const { body, stats } = rewriteBody(note.body ?? '', ctx);
	const frontmatter = buildFrontmatter(note, ctx);
	const text = body === '' || body.endsWith('\n') ? body : `${body}\n`;
	return { content: `${frontmatter}\n${text}`, stats };
}
