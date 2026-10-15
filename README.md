# Joplin Importer

Obsidian plugin that imports notes from Joplin. Status: early scaffold, no import logic yet.

## Goal
One command, "Import from Joplin", that reads your notebooks, notes, tags and attachments from Joplin and writes them into your vault as Markdown, with a dry run and a verification report.

## Current features
- Settings tab: Joplin API URL (blank means auto-discover on ports 41184 to 41194) and API token.
- Command "Dry run: count Joplin notes": counts notebooks, notes and tags through the Joplin Data API. Read-only.

## Using it with Joplin
1. In Joplin, enable the Web Clipper service (Options, Web Clipper) and copy the authorization token.
2. Paste the token in the plugin settings.
3. Run the dry-run command from the command palette.

The token gives full access to your Joplin data. This plugin only sends GET requests. The token is stored in the plugin's data.json inside your vault, so do not commit or sync that file publicly.

## Development
```bash
npm install
npm run dev      # watch build to main.js
npm run build    # typecheck and production build
```
Develop in a separate, empty vault, never your main one. Link or copy `main.js`, `manifest.json` and `styles.css` (if present) into `<dev-vault>/.obsidian/plugins/joplin-importer/`.

## Roadmap
See the project notes (private). Phase 1 covers notebooks to folders, attachments, internal link rewriting, frontmatter, a dry run and a report.

## Licence
MIT. Project structure follows the official [obsidian-sample-plugin](https://github.com/obsidianmd/obsidian-sample-plugin).
