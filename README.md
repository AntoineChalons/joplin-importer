# Joplin Importer

Obsidian plugin that imports notes from Joplin. Status: early development, loading layer only; nothing is written to your vault yet.

## Goal
One command, "Import from Joplin", that reads your notebooks, notes, tags and attachments from Joplin and writes them into your vault as Markdown, with a dry run and a verification report.

## Current features
- Settings tab: Joplin API URL (blank means auto-discover on ports 41184 to 41194) and API token.
- Command "Dry run: count Joplin notes": loads an inventory (notebooks, notes, tags, attachment metadata) with a progress notice, scans note bodies for internal references and maps tags. Reports counts, notebook nesting, notes in unknown notebooks, encrypted notes, references (images, note links, attachment links), unresolved references, unparsed `:/id` mentions, unreferenced attachments, and tag results. Read-only.
- Folder path index: builds notebook paths from `parent_id` (flat list) or `children` (tree), with guards for missing parents and cycles.
- Reference scanner: finds `![alt](:/id)`, `[text](:/id)` (with optional anchor and title) and `<img src=":/id">`. Anything else containing `:/` plus an id is counted as an unparsed mention so it is never silently dropped.
- Tag mapping: reads which notes carry each Joplin tag and converts tag names to valid Obsidian tags (spaces and unsupported punctuation become hyphens, purely numeric tags get a `tag-` prefix, tags that differ only by case are merged). Tags that cannot be converted are reported.

## Using it with Joplin
1. In Joplin, enable the Web Clipper service and copy the authorization token.
2. Paste the token in the plugin settings.
3. Run the dry-run command from the command palette.

The token gives full access to your Joplin data. This plugin only sends GET requests. The token is stored in the plugin's data.json inside your vault, so do not commit or sync that file publicly.

## Development
```bash
npm install
npm test         # unit tests (needs Node 20.6 or newer)
npm run dev      # watch build to main.js
npm run build    # typecheck and production build
```
Develop in a separate, empty vault, never your main one. Copy `main.js` and `manifest.json` into `<dev-vault>/.obsidian/plugins/joplin-importer/`.

The Joplin client takes an injectable HTTP function, so the tests run in plain Node without Obsidian. Tests are not part of the typecheck in `npm run build`.

## Licence
MIT. Project structure follows the official [obsidian-sample-plugin](https://github.com/obsidianmd/obsidian-sample-plugin).
