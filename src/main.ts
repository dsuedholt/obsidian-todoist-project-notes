import { Notice, normalizePath, Plugin, TFile, getFrontMatterInfo, Vault, TFolder } from 'obsidian';
import { TodoistApi, Project } from '@doist/todoist-api-typescript';
import { join } from 'path';

import { NoSelectedFolderModal } from './modals';
import { DeletedProjectHandling, DEFAULT_SETTINGS, ProjectNotesSettings, ProjectNotesTab } from './settings';

class ProjectInfo {
	projects: Map<string, Project>;
	children: Map<string, string[]>;
	roots: string[];
	notePaths: Map<string, string>;
	
	// internal use: keeping track of moved, modified, deleted projects
	existingNotes: Map<string, string[]>;

	initProjects() {
		this.projects = new Map();
		this.children = new Map();
		this.roots = [];
		this.notePaths = new Map();
	}

	constructor() {
		this.existingNotes = new Map();
		this.initProjects();
	}
}

export default class ProjectNotesPlugin extends Plugin {
	settings: ProjectNotesSettings;
	projectInfo: ProjectInfo;
	templateFrontMatter: string;
	templateBody: string;

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

					const note = this.app.vault.getFileByPath(notes[0]);
					if (!note) return;
					let desc = t.description;
					if (!desc) {
						desc = '';
					}
					
					const insert = `Project note: [[${note.basename}]]`;
					const lines = desc.split('\n');
					if (lines[0]?.startsWith('Project note: [[')) {
						lines[0] = insert;
					}
					else {
						lines.unshift(insert);
					}

					desc = lines.join('\n');
					
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

	// check existing files in the project folder for Todoist project IDs
	getExistingNotes() {
		this.projectInfo.existingNotes.clear();

		const rootFolder = this.app.vault.getFolderByPath(this.settings.notefolder);
		if (!rootFolder) {
			new Notice(`The specified notes folder '${this.settings.notefolder}' does not exist.`);
			throw new Error('Notes folder not found.');
		}

		const proms = Array<Promise<void>>();
		
		Vault.recurseChildren(rootFolder, (f) => {
			if (!(f instanceof TFile)) return;
			if (f.path.startsWith(normalizePath(join(this.settings.notefolder, this.settings.archivefolder)))) return;

			proms.push(this.app.fileManager.processFrontMatter(f, (frontmatter) => {
				const id = frontmatter['todoist-project-id'];
				if (id) {
					const files = this.projectInfo.existingNotes.get(id);
					if (files && !files.includes(f.path)) {
						files.push(f.path);	
					} else {
						this.projectInfo.existingNotes.set(id, [f.path]);
					}
				}
			}));
		});
		return Promise.all(proms);
	}

	updateProjectNotes() {
		this.getExistingNotes()
			.then(() => {
			this.getProjectsTree()
				.then(() => {
					this.templateBody = '';
					this.templateFrontMatter = '';

					if (this.settings.templatefile === '') { return; }

					const templateFile = this.app.vault.getFileByPath(normalizePath(this.settings.templatefile + ".md"));
					if (!templateFile) {
						new Notice('The specified template file could not be loaded. Aborting.');
						throw new Error('Template file not found.');
					}

					this.app.vault.cachedRead(templateFile)
						.then((template) => {
							const frontMatterInfo = getFrontMatterInfo(template);
							if (frontMatterInfo.exists) {
								this.templateFrontMatter = frontMatterInfo.frontmatter;
							}
							this.templateBody = template.slice(frontMatterInfo.contentStart);
						});
				})
				.then(() => {

					// construct all note paths for the project tree first, and then actually create the notes in a second step. 
					// this ensures that the note path for each project is available for templating at note creation time.
					
					this.updateNotePathForProjectAndChildren().then(() => {
					
						this.projectInfo.roots.forEach(p => {
							this.createNoteForProjectAndChildren(p);
						});
						
						// handle deleted projects
						const deletedProjects = Array.from(this.projectInfo.existingNotes.keys()).filter(id => !this.projectInfo.projects.has(id));
						const method = this.settings.deletedProjectHandling;
						const archiveFolder = this.settings.archivefolder;
						const archivePath = normalizePath(join(this.settings.notefolder, archiveFolder));
						const archiveFolderExists = this.app.vault.getFolderByPath(archivePath);
						
						const filePromises = new Array<Promise<void>>();
						if (method !== DeletedProjectHandling.Ignore) {
							if (method === DeletedProjectHandling.Archive) {
								if (!archiveFolderExists) {
									this.app.vault.createFolder(archivePath)
										.catch((error) => {
											console.error(error);
											new Notice(`Error creating archive folder '${archiveFolder}'.`);
											throw new Error('Archive folder not found.');
										});
								}
							}
							deletedProjects.forEach(id => {
								const notes = this.projectInfo.existingNotes.get(id);
								if (notes) {
									notes.forEach(note => {
										const oldFile = this.app.vault.getFileByPath(note);
										if (oldFile) {
											switch (method) {
												case DeletedProjectHandling.Archive:
													filePromises.push(this.app.vault.rename(oldFile, join(archivePath, id + "-" + oldFile.basename) + ".md"));
													break;
												case DeletedProjectHandling.Delete:
													filePromises.push(this.app.vault.delete(oldFile));
													break;
											}
										}
									});
								}
							});
						}		
						Promise.all(filePromises).then(() => {
							if (this.settings.linktasks) {
								this.linkTasks();
							}
						});
					});
				})
			});
	}

	// iteratively walk the project tree and construct path names for project notes
	async updateNotePathForProjectAndChildren() {
		type Leaf = { id: string, parentPath: string };

		const folderPromises = new Array<Promise<TFolder>>();

		const currLeaves = new Array<Leaf>();
		this.projectInfo.roots.forEach(r => {
			currLeaves.push({ id: r, parentPath: '' });
		});

		const baseDir = this.settings.notefolder;

		while (currLeaves.length > 0) {
			const nextLeaves = Array<Leaf>();
			currLeaves.forEach(async l => {
				let path = l.parentPath;
				const project = this.projectInfo.projects.get(l.id);
				if (!project) return;

				if (this.settings.nested) {
					path = join(path, project.name);
				} else {
					path = path + (path ? this.settings.separator : '') + project.name;
				}
				
				const fullpath = normalizePath(join(baseDir, path));
				this.projectInfo.notePaths.set(l.id, fullpath)
				
				const children = new Array<Leaf>();
				this.projectInfo.children.get(l.id)?.forEach(c => {
					children.push({ id: c, parentPath: path });
				});

				if (children.length > 0 && this.settings.nested && !this.app.vault.getAbstractFileByPath(fullpath)) {
					folderPromises.push(this.app.vault.createFolder(fullpath));
				}
				
				nextLeaves.push(...children);
			});
			currLeaves.length = 0;
			currLeaves.push(...nextLeaves);

			await Promise.all(folderPromises);
		}
	}
	
	createNoteForProjectAndChildren(currId: string) {
		const p = this.projectInfo.projects.get(currId);
		if (!p) return;

		const noteContent = `---\ntodoist-project-id: '${p.id}'\n${this.templateFrontMatter}---\n\n${this.templateBody}`;
		
		const path = this.projectInfo.notePaths.get(currId);
		if (!path) {
			return;
		}

		const noteFile = this.app.vault.getFileByPath(path + ".md")
		if (!noteFile) {
			const existingNotes = this.projectInfo.existingNotes.get(p.id);
			if (existingNotes) {
				if (existingNotes.length > 1) {
					new Notice(`Multiple notes containing the same Project ID as '${path}' exist. Please deal with this manually.`);
				} else {
					const oldFile = this.app.vault.getFileByPath(existingNotes[0]);
					if (oldFile) {
						this.app.vault.rename(oldFile, path + ".md")
							.catch((error) => {
								console.error(error);
								new Notice(`Error moving note to '${path}'. Does it already exist somewhere?`);
							});
					}
				}
			} else {
				this.app.vault.create(path + ".md", noteContent)
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

			this.projectInfo.children.get(currId)?.forEach(c => {
				this.createNoteForProjectAndChildren(c);
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
	
	async onload() {
		this.projectInfo = new ProjectInfo();

		await this.loadSettings();

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
