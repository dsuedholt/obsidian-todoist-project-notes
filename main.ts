import { App, Modal, Notice, normalizePath, Plugin, PluginSettingTab, Setting, TAbstractFile, TFile } from 'obsidian';
import { TodoistApi, Project } from '@doist/todoist-api-typescript';
import { join } from 'path';

enum DeletedProjectHandling {
	Ignore = 'ignore',
	Archive = 'archive',
	Delete = 'delete'
}

interface ProjectNotesSettings {
	apikey: string;
	notefolder: string;
	nested: boolean;
	separator: string;
	deletedProjectHandling: DeletedProjectHandling;
	archivefolder: string;
}

const DEFAULT_SETTINGS: ProjectNotesSettings = {
	apikey: '',
	notefolder: '',
	nested: true,
	separator: ' ~ ',
	deletedProjectHandling: DeletedProjectHandling.Ignore,
	archivefolder: '__ArchivedNotes'
}

class ProjectInfo {
	projects: Map<string, Project>;
	children: Map<string, string[]>;
	roots: string[];
	existingNotes: Map<string, TFile[]>;

	initProjects() {
		this.projects = new Map();
		this.children = new Map();
		this.roots = [];
	}

	constructor() {
		this.existingNotes = new Map();
		this.initProjects();
	}
}

export default class ProjectNotesPlugin extends Plugin {
	settings: ProjectNotesSettings;
	projectInfo: ProjectInfo;

	getTodoistApi() {
		const api = new TodoistApi(this.settings.apikey);
		return api;
	}

	syncProjectNotes() {
		this.getProjectsTree().then((projInfo) => {
			if (!projInfo) return;
			// check existing files in the project folder for Todoist project IDs
			const rootFolder = this.app.vault.getFolderByPath(this.settings.notefolder);
			if (!rootFolder) {
				new Notice(`The specified notes folder '${this.settings.notefolder}' does not exist.`);
				return;
			}

			projInfo?.roots.forEach(p => {
					this.syncNoteForProjectAndChildren(projInfo, p);
				});
			
			// handle deleted projects
			const deletedProjects = Array.from(projInfo.existingNotes.keys()).filter(id => !projInfo?.projects.has(id));
			const method = this.settings.deletedProjectHandling;
			if (method !== DeletedProjectHandling.Ignore) {
				const archiveFolder = this.settings.archivefolder;
				const archivePath = normalizePath(join(this.settings.notefolder, archiveFolder));
				const archiveFolderExists = this.app.vault.getFolderByPath(archivePath);
				if (method === DeletedProjectHandling.Archive) {
					if (!archiveFolderExists) {
						this.app.vault.createFolder(archivePath);
					}
				}
				deletedProjects.forEach(id => {
					const notes = projInfo.existingNotes.get(id);
					if (notes) {
						notes.forEach(note => {
							switch (method) {
								case DeletedProjectHandling.Archive:
									this.app.vault.rename(note, join(archivePath, note.basename) + ".md");
									break;
								case DeletedProjectHandling.Delete:
									this.app.vault.delete(note);
									break;
							}
						});
					}
				});
			}

		});
	}

	syncNoteForProjectAndChildren(info: ProjectInfo, currId: string, path = '') {
		const p = info.projects.get(currId);
		if (!p) return;

		const baseDir = this.settings.notefolder;

		if (this.settings.nested) {
			path = join(path, p.name);
		} else {
			path = path + (path ? this.settings.separator : '') + p.name;
		}
		const noteContent = `---\ntodoist-project-id: '${p.id}'\n---`;
		
		const normalizedDir = normalizePath(join(baseDir, path));
		const noteFile = this.app.vault.getFileByPath(normalizedDir + ".md")
		if (!noteFile) {
			const existingNotes = info.existingNotes.get(p.id);
			if (existingNotes) {
				if (existingNotes.length > 1) {
					new Notice(`Multiple notes containing the same Project ID as '${path}' exist. Please deal with this manually.`);
				} else {
					this.app.vault.rename(existingNotes[0], normalizedDir + ".md");
				}
			} else {
				this.app.vault.create(normalizedDir + ".md", noteContent);
			}
		}
		else {
			this.app.fileManager.processFrontMatter(noteFile, (frontmatter) => {
				if (frontmatter['todoist-project-id'] !== p.id) {
					new Notice(`A note with the name '${path}' already exists, but with a different Todoist project ID. Please rename or move the note manually.`);
				}
			});
		}
		
		const children = info.children.get(currId);

		if (children) {
			if (this.settings.nested && !this.app.vault.getAbstractFileByPath(normalizedDir)) {
				this.app.vault.createFolder(normalizedDir);
			}

			info.children.get(currId)?.forEach(c => {
				this.syncNoteForProjectAndChildren(info, c, path);
			});
		}
	}

	// get all projects from Todoist and sort them into a tree structure
	getProjectsTree() {
		const api = this.getTodoistApi();
		this.projectInfo.initProjects();
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
				}, this.projectInfo)
			)
			.catch((error) => { 
				console.error(error);
				new Notice('Error fetching projects from Todoist. Please check your API key and try again.');
			});
		return projects;
	}

	// called when any file in the vault is created, modified or renamed
	checkProjectInfo(f: TAbstractFile) {
		if (!(f instanceof TFile)) return;
		if (!(this.settings.notefolder == '/' || f.path.startsWith(this.settings.notefolder))) return;
		if (f.path.startsWith(normalizePath(join(this.settings.notefolder, this.settings.archivefolder)))) return;

		this.app.fileManager.processFrontMatter(f, (frontmatter) => {
			const id = frontmatter['todoist-project-id'];
			if (id) {
				const files = this.projectInfo.existingNotes.get(id);
				if (files && !files.includes(f)) {
					files.push(f);	
				} else {
					this.projectInfo.existingNotes.set(id, [f]);
				}
			}
		});

	}

	// called when any file in the vault is deleted
	removeProjectInfo(f: TAbstractFile) {
		if (!(f instanceof TFile)) return;
		if (!(this.settings.notefolder == '/' || f.path.startsWith(this.settings.notefolder))) return;
	
		this.projectInfo.existingNotes.forEach((files, id) => {
			const index = files.indexOf(f);
			if (index > -1) {
				files.splice(index, 1);
				if (files.length === 0) {
					this.projectInfo.existingNotes.delete(id);
				}
			}
		});
	}	
	
	async onload() {
		this.projectInfo = new ProjectInfo();

		await this.loadSettings();
		this.registerEvent(this.app.vault.on('create', (file) => {
			this.checkProjectInfo(file);
		}));

		this.registerEvent(this.app.vault.on('modify', (file) => {
			this.checkProjectInfo(file);
		}));

		this.registerEvent(this.app.vault.on('rename', (file) => {
			this.checkProjectInfo(file);
		}));

		this.registerEvent(this.app.vault.on('delete', (file) => {
			this.removeProjectInfo(file);
		}));


		this.addCommand({
			id: 'sync-project-notes',
			name: 'Sync Todoist project notes',
			callback: async () => {
				if (!this.validateSettings(false)) {
					return;
				}

				this.syncProjectNotes();
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
