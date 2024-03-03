import { Notice, normalizePath, Plugin, TAbstractFile, TFile } from 'obsidian';
import { TodoistApi, Project } from '@doist/todoist-api-typescript';
import { join } from 'path';

import { NoSelectedFolderModal } from './modals';
import { DeletedProjectHandling, DEFAULT_SETTINGS, ProjectNotesSettings, ProjectNotesTab } from './settings';

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

	linkTasks() {
		const api = this.getTodoistApi();
		api.getTasks()
			.then((tasks) => {
				tasks.forEach(t => {
					const notes = this.projectInfo.existingNotes.get(t.projectId);
					if (!notes) return;
					if (notes.length > 1) return;

					const note = notes[0];
					let desc = t.description;
					if (!desc) {
						desc = '';
					}
					
					const insert = `Project note: [[${note.basename}]]`;
					if (desc.includes(insert)) return;
					
					desc = insert + '\n' + desc;
					
					api.updateTask(t.id, { description: desc })
						.catch((error) => {
							console.error(error);
							new Notice(`Error updating task '${t.content}'.`);
						});
				});
			})
			.catch((error) => {
				console.error(error);
				new Notice('Error fetching tasks from Todoist. Please check your API key and try again.');
			});
	
	}

	updateProjectNotes() {
		this.getProjectsTree().then(() => {
			// check existing files in the project folder for Todoist project IDs
			const rootFolder = this.app.vault.getFolderByPath(this.settings.notefolder);
			if (!rootFolder) {
				new Notice(`The specified notes folder '${this.settings.notefolder}' does not exist.`);
				return;
			}

			this.projectInfo.roots.forEach(p => {
					this.updateNoteForProjectAndChildren(p);
				});
			
			// handle deleted projects
			const deletedProjects = Array.from(this.projectInfo.existingNotes.keys()).filter(id => !this.projectInfo.projects.has(id));
			const method = this.settings.deletedProjectHandling;
			if (method !== DeletedProjectHandling.Ignore) {
				const archiveFolder = this.settings.archivefolder;
				const archivePath = normalizePath(join(this.settings.notefolder, archiveFolder));
				const archiveFolderExists = this.app.vault.getFolderByPath(archivePath);
				if (method === DeletedProjectHandling.Archive) {
					if (!archiveFolderExists) {
						this.app.vault.createFolder(archivePath)
							.catch((error) => {
								console.error(error);
								new Notice(`Error creating archive folder '${archiveFolder}'.`);
							});
					}
				}
				deletedProjects.forEach(id => {
					const notes = this.projectInfo.existingNotes.get(id);
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
		}).then(() => {
			if (this.settings.linktasks) {
				this.linkTasks();
			}
		});
	}

	updateNoteForProjectAndChildren(currId: string, path = '') {
		const p = this.projectInfo.projects.get(currId);
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
			const existingNotes = this.projectInfo.existingNotes.get(p.id);
			if (existingNotes) {
				if (existingNotes.length > 1) {
					new Notice(`Multiple notes containing the same Project ID as '${path}' exist. Please deal with this manually.`);
				} else {
					this.app.vault.rename(existingNotes[0], normalizedDir + ".md")
						.catch((error) => {
							console.error(error);
							new Notice(`Error moving note to '${path}'. Does it already exist somewhere?`);
						});
				}
			} else {
				this.app.vault.create(normalizedDir + ".md", noteContent)
					.catch((error) => {
						console.error(error);
						new Notice(`Error creating note '${path}'. Does it already exist somewhere?`);
					});
			}
		}
		else {
			this.app.fileManager.processFrontMatter(noteFile, (frontmatter) => {
				if (frontmatter['todoist-project-id'] !== p.id) {
					new Notice(`A note with the name '${path}' already exists, but with a different Todoist project ID. Please rename or move the note manually.`);
				}
			});
		}
		
		const children = this.projectInfo.children.get(currId);

		if (children) {
			if (this.settings.nested && !this.app.vault.getAbstractFileByPath(normalizedDir)) {
				this.app.vault.createFolder(normalizedDir);
			}

			this.projectInfo.children.get(currId)?.forEach(c => {
				this.updateNoteForProjectAndChildren(c, path);
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

		this.app.vault.getFiles().forEach(f => {
			this.checkProjectInfo(f);
		});

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
			id: 'update-project-notes',
			name: 'Update Todoist project notes',
			callback: async () => {
				if (!this.validateSettings(false)) {
					return;
				}

				this.updateProjectNotes();
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
