import { App, PluginSettingTab, Setting } from "obsidian";

import ProjectNotesPlugin from "./main";

export enum DeletedProjectHandling {
	Ignore = 'ignore',
	Archive = 'archive',
	Delete = 'delete'
}

export interface ProjectNotesSettings {
	apikey: string;
	notefolder: string;
	nested: boolean;
	separator: string;
	deletedProjectHandling: DeletedProjectHandling;
	archivefolder: string;
    linktasks: boolean;
    templatefile: string;
}

export const DEFAULT_SETTINGS: ProjectNotesSettings = {
	apikey: '',
	notefolder: '',
	nested: true,
	separator: ' ~ ',
	deletedProjectHandling: DeletedProjectHandling.Archive,
	archivefolder: '__ArchivedNotes',
    linktasks: false,
    templatefile: ''
}

export class ProjectNotesTab extends PluginSettingTab {
	plugin: ProjectNotesPlugin;

	constructor(app: App, plugin: ProjectNotesPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

        containerEl.createEl('h2', {text: 'Todoist Integration'})

		const desc = document.createDocumentFragment()		

		desc.append(
			document.createTextNode('Enter your Todoist API key. It will be stored unencrypted in your .obsidian directory - be careful when syncing your Vault! You can see your Todoist API Key '),
			desc.createEl('a', {
				href: 'https://app.todoist.com/app/settings/integrations/developer',
				text: 'here'
			}),
			document.createTextNode('.')
		)

		new Setting(containerEl)
			.setName('Todoist API key')
			.setDesc(desc)
			.addText(text => text
				.setPlaceholder('Enter your API key...')
				.setValue(this.plugin.settings.apikey)
				.onChange(async (value) => {
					this.plugin.settings.apikey = value;
					await this.plugin.saveSettings();
				}));
		
        new Setting(containerEl)
            .setName('Insert links in task description')
            .setDesc('Insert a link to the Project Note into the descriptions of all Todoist tasks of the project.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.linktasks)
                .onChange(async (value) => {
                    this.plugin.settings.linktasks = value;
                    await this.plugin.saveSettings();
                }));


        containerEl.createEl('h2', {text: 'Project Notes Organization'})
        
		new Setting(containerEl)
			.setName('Project notes folder')
			.setDesc('Choose the folder where you want to store your project notes. NOTE: Please restart Obsidian after changing this setting, otherwise the plugin will not keep track of existing project notes properly.')
			.addText(text => text
				.setPlaceholder('Enter the folder name...')
				.setValue(this.plugin.settings.notefolder)
				.onChange(async (value) => {
					this.plugin.settings.notefolder = value;
					await this.plugin.saveSettings();
				}));
		
		new Setting(containerEl)
			.setName('Nested folders')
			.setDesc('Enabled: Sort subprojects into nested folders.\nDisabled: Create all project notes directly in the folder.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.nested)
				.onChange(async (value) => {
					this.plugin.settings.nested = value;
					await this.plugin.saveSettings();
				}));

		function updateSepDescription(sep: string) {
			const desc = document.createDocumentFragment();
			desc.append(
				document.createTextNode(`When nested folders are disabled, this string will be used to separate the project names in the note file path like this: Project${sep}Subproject${sep}Subsubproject.`),
			);
			if (sep.match(/[\\/:]/)) {
				desc.append(
					desc.createEl('br'),
					desc.createEl('p',{
						text: 'WARNING:	The separator string cannot contain any of these characters: /, \\, :',
					}),
				);
			}
			else if (sep.match(/[#^[\]|]/)) {
				desc.append(
					desc.createEl('br'),
					desc.createEl('p',{
						text: "WARNING: Obsidian's file linking will break if the separator includes any of these: # ^ [ ] |",
					}),
				);
			}
			sepSetting.setDesc(desc);
		}

		const sepSetting = new Setting(containerEl)
			.setName('Subproject separator string')
			.addText(text => text
				.setPlaceholder('Enter the separator string...')
				.setValue(this.plugin.settings.separator)
				.onChange(async (value) => {
					this.plugin.settings.separator = value;
					await this.plugin.saveSettings();
					updateSepDescription(value);
				}));
		
		updateSepDescription(this.plugin.settings.separator);

        new Setting(containerEl) 
            .setName('Template file')
            .setDesc('Choose a template file to insert into new project notes.')
            .addText(text => text
                .setPlaceholder('Enter the file name...')
                .setValue(this.plugin.settings.templatefile)
                .onChange(async (value) => {
                    this.plugin.settings.templatefile = value;
                    await this.plugin.saveSettings();
                }));

		containerEl.createEl('h2', {text: 'Deleted Projects'})
		containerEl.createEl('p', {text: 'The plugin saves the unique Todoist project ID in the note file. Renamed projects will automatically be moved. Deleted projects will be handled according to the setting below.'});

		new Setting(containerEl)
			.setName('Deleted project handling')
			.setDesc('Choose what to do with deleted projects')
			.addDropdown(dropdown => dropdown
				.addOption('ignore', 'Ignore')
				.addOption('archive', 'Move to Archive')
				.addOption('delete', 'Delete')
				.setValue(this.plugin.settings.deletedProjectHandling)
				.onChange(async (value) => {
					this.plugin.settings.deletedProjectHandling = value as DeletedProjectHandling;
					await this.plugin.saveSettings();
				}));
			
		new Setting(containerEl)
			.setName('Archive folder')
			.setDesc('Choose the folder (relative to the Project Notes folder) where you want to store archived project notes.')
			.addText(text => text
				.setPlaceholder('Enter the folder name...')
				.setValue(this.plugin.settings.archivefolder)
				.onChange(async (value) => {
					this.plugin.settings.archivefolder = value;
					await this.plugin.saveSettings();
				}));
	}
}