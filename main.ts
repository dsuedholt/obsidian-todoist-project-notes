import { App, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { TodoistApi, Project } from '@doist/todoist-api-typescript';
import { join } from 'path';

interface ProjectNotesSettings {
	apikey: string;
	notefolder: string;
	nested: boolean;
	parentnotes: boolean;
	separator: string;
}

const DEFAULT_SETTINGS: ProjectNotesSettings = {
	apikey: '',
	notefolder: '',
	nested: true,
	parentnotes: true,
	separator: ' ~ '
}

class ProjectInfo {
	projects: Map<string, Project>;
	children: Map<string, string[]>;
	roots: string[];

	constructor() {
		this.projects = new Map();
		this.children = new Map();
		this.roots = [];
	}
}

export default class ProjectNotesPlugin extends Plugin {
	settings: ProjectNotesSettings;

	getTodoistApi() {
		const api = new TodoistApi(this.settings.apikey);
		return api;
	}

	createProjectNotes() {
		this.getProjectsTree().then((projInfo) => {
			projInfo?.roots.forEach(p => {
					this.createNoteForProjectAndChildren(projInfo, p);
				});
		});
	}

	createNoteForProjectAndChildren(info: ProjectInfo, currId: string, path = '') {
		const p = info.projects.get(currId);
		if (!p) return;

		const baseDir = this.settings.notefolder;

		if (this.settings.nested) {
			path = join(path, p.name);
		} else {
			path = path + (path ? this.settings.separator : '') + p.name;
		}
		const noteContent = `---\ntodoist-project-id: '${p.id}'\n---`;
		
		const children = info.children.get(currId);

		if (this.settings.parentnotes || !children) {
			this.app.vault.create(join(baseDir, path) + ".md", noteContent);
		}

		if (children) {			
			if (this.settings.nested) {
				this.app.vault.createFolder(join(baseDir, path));
			}

			info.children.get(currId)?.forEach(c => {
				this.createNoteForProjectAndChildren(info, c, path);
			});
		}
	}

	// get all projects from Todoist and sort them into a tree structure
	getProjectsTree() {
		const api = this.getTodoistApi();
		const projects = api.getProjects()
			.then((projects) => 
				projects.reduce((acc, p) => {
					acc.projects.set(p.id, p);
					if (p.parentId) {
						if (!acc.children.has(p.parentId)) {
							acc.children.set(p.parentId, []);
						}
						acc.children.get(p.parentId)?.push(p.id);
					} else {
						acc.roots.push(p.id);
					}
					return acc;
				}, new ProjectInfo())
			)
			.catch((error) => { 
				console.error(error);
				new Notice('Error fetching projects from Todoist. Please check your API key and try again.');
			});
		return projects;
	}

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: 'create-project-notes',
			name: 'Create Project Notes',
			callback: async () => {
				if (!this.validateSettings(false)) {
					return;
				}

				this.createProjectNotes();
			}
		});

		this.addSettingTab(new ProjectNotesTab(this.app, this));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	validateSettings(checking: boolean) {
		if (this.settings.apikey === '') {
			new Notice('Please enter your Todoist API key in the settings.');
			return false;
		}
		if (this.settings.notefolder === '') {
			new NoSelectedFolderModal(this.app, this).open();
			return this.settings.notefolder === '';
		}
		return true;
	}
}

class NoSelectedFolderModal extends Modal {
	constructor(app: App, public plugin: ProjectNotesPlugin) {
		super(app);
		this.plugin = plugin;
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.createEl('p', {text: 'You have not set a folder to store your project notes. Do you want to use the root folder?'});

		const buttonContainer = contentEl.createDiv('modal-button-container');		
		buttonContainer.createEl('button', {text: 'Yes', cls: 'modal-button'})
			.addEventListener('click', () => {
				this.plugin.settings.notefolder = '/';
				this.close();
			});
		
		buttonContainer.createEl('button', {text: 'Cancel', cls: 'modal-button'})
			.addEventListener('click', () => {
				this.close();
			});

	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class ProjectNotesTab extends PluginSettingTab {
	plugin: ProjectNotesPlugin;

	constructor(app: App, plugin: ProjectNotesPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

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
			.setName('Todoist API Key')
			.setDesc(desc)
			.addText(text => text
				.setPlaceholder('Enter your API key...')
				.setValue(this.plugin.settings.apikey)
				.onChange(async (value) => {
					this.plugin.settings.apikey = value;
					await this.plugin.saveSettings();
				}));
		
		new Setting(containerEl)
			.setName('Project Notes Folder')
			.setDesc('Choose the folder where you want to store your project notes.')
			.addText(text => text
				.setPlaceholder('Enter the folder name...')
				.setValue(this.plugin.settings.notefolder)
				.onChange(async (value) => {
					this.plugin.settings.notefolder = value;
					await this.plugin.saveSettings();
				}));
		
		new Setting(containerEl)
			.setName('Nested Folders')
			.setDesc('Enabled: Sort subprojects into nested folders.\nDisabled: Create all project notes directly in the folder.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.nested)
				.onChange(async (value) => {
					this.plugin.settings.nested = value;
					await this.plugin.saveSettings();
				}));
		
		new Setting(containerEl)
			.setName('Generate Notes for Parent Projects')
			.setDesc('Enabled: Generate notes for all projects.\nDisabled: Only generate Notes for "Leaf" subprojects without children.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.parentnotes)
				.onChange(async (value) => {
					this.plugin.settings.parentnotes = value;
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
			.setName('Subproject Separator String')
			.addText(text => text
				.setPlaceholder('Enter the separator string...')
				.setValue(this.plugin.settings.separator)
				.onChange(async (value) => {
					this.plugin.settings.separator = value;
					await this.plugin.saveSettings();
					updateSepDescription(value);
				}));
		
		updateSepDescription(this.plugin.settings.separator);
	}
}
