import { App, PluginSettingTab, Setting } from 'obsidian';
import type JoplinImporterPlugin from './main';

export interface JoplinImporterSettings {
	baseUrl: string;
	token: string;
}

export const DEFAULT_SETTINGS: JoplinImporterSettings = {
	baseUrl: '',
	token: '',
};

export class JoplinImporterSettingTab extends PluginSettingTab {
	private readonly plugin: JoplinImporterPlugin;

	constructor(app: App, plugin: JoplinImporterPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Joplin API URL')
			.setDesc('Leave blank to auto-discover Joplin on ports 41184 to 41194.')
			.addText((text) =>
				text
					.setPlaceholder('http://127.0.0.1:41184')
					.setValue(this.plugin.settings.baseUrl)
					.onChange(async (value) => {
						this.plugin.settings.baseUrl = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Joplin API token')
			.setDesc('From Joplin options, Web Clipper. Gives full access to your Joplin data; this plugin only reads.')
			.addText((text) => {
				text.inputEl.type = 'password';
				text
					.setValue(this.plugin.settings.token)
					.onChange(async (value) => {
						this.plugin.settings.token = value.trim();
						await this.plugin.saveSettings();
					});
			});
	}
}
