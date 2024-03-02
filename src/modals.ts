import { App, Modal } from 'obsidian';
import ProjectNotesPlugin from './main';

export class NoSelectedFolderModal extends Modal {
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