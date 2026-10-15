# Joplin Importer

Obsidian plugin that imports your notes from Joplin through the Joplin Data API. Desktop only.

## Maintenance status
I wrote this plugin to migrate my own notes from Joplin to Obsidian, and it covers my needs. I am not investing more time in it. It is MIT licensed: anyone is welcome to fork it and improve it.

## What it does
- Command "Dry run: count Joplin notes": read-only. Loads notebooks, notes, tags and attachment metadata and reports counts, planned paths, references, tag results and anything that would be skipped.
- Command "Import from Joplin": asks for confirmation, then writes notes into a `Joplin import` folder of the current vault, one vault folder per notebook (empty notebooks are not created), and an `Import report.md` with a count check against Joplin.
- Never overwrites: existing files are left alone. Running the import a second time therefore writes nothing and reports every note as failed because it already exists. The import is meant to be run once.
- Frontmatter per note: aliases, tags, created, updated, source, author, todo fields and `joplin_id`.
- File creation and modification times are set from the Joplin times where Obsidian allows it, and the report says how many were kept.
- Tags are converted to valid Obsidian tags (spaces and unsupported punctuation become hyphens; purely numeric tags get a `tag-` prefix; tags that differ only by case are merged). Tags written as `@name` become `people/name`.
- Note links, image embeds and attachment links in the Joplin `:/id` form are rewritten to Obsidian links and embeds, and referenced attachments are downloaded into the import folder.
- Notes in HTML format and encrypted notes are skipped and listed in the report.

## Limits
- Tested only on macOS, with one real library of about 114 notes. Links and attachments were verified on a small set of test notes only. Windows and Linux path handling is untested.
- No re-run or update mode.
- Joplin must be running with the Web Clipper service enabled.

## Using it
1. In Joplin, enable the Web Clipper service and copy the authorization token.
2. Install the plugin in a test vault first, never your main vault, and paste the token in the plugin settings.
3. Run "Dry run: count Joplin notes" and check the numbers.
4. Run "Import from Joplin", read the confirmation, and check `Joplin import/Import report.md`.
5. Back up your Joplin data before you start. The plugin only sends GET requests to Joplin.

The token gives full access to your Joplin data. It is stored in the plugin's `data.json` inside your vault, so do not commit or sync that file publicly.

## Development
```bash
npm install
npm test         # unit tests (needs Node 20.6 or newer)
npm run dev      # watch build to main.js
npm run build    # typecheck and production build
```
Develop in a separate, empty vault. Copy `main.js` and `manifest.json` into `<dev-vault>/.obsidian/plugins/joplin-importer/`.

The Joplin client takes an injectable HTTP function, so the tests run in plain Node without Obsidian. Tests are not part of the typecheck in `npm run build`.

## Licence
MIT. Project structure follows the official [obsidian-sample-plugin](https://github.com/obsidianmd/obsidian-sample-plugin).
