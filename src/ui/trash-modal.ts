import { App, Modal, Notice } from 'obsidian';
import { SupernoteFile } from '../api/types';

/**
 * Modal for managing trashed (excluded) notes
 */
export class TrashManagementModal extends Modal {
    private trashedIds: string[];
    private trashedNotes: SupernoteFile[];
    private onRestore: (noteId: string) => void;
    private onRestoreAll: () => void;

    constructor(
        app: App,
        trashedIds: string[],
        trashedNotes: SupernoteFile[],
        onRestore: (noteId: string) => void,
        onRestoreAll: () => void
    ) {
        super(app);
        this.trashedIds = trashedIds;
        this.trashedNotes = trashedNotes;
        this.onRestore = onRestore;
        this.onRestoreAll = onRestoreAll;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();

        // Modal styling
        this.modalEl.addClass('supernote-modal-large');
        this.titleEl.setText('Manage trashed notes');

        // Description
        contentEl.createEl('p', {
            text: 'These notes have been excluded from sync. Restore them to include them in future syncs.',
            cls: 'supernote-description-block'
        });

        // Count
        const countEl = contentEl.createEl('p', { cls: 'supernote-trash-count' });
        countEl.createEl('strong', { text: String(this.trashedIds.length) });
        countEl.appendText(' note(s) currently trashed');

        if (this.trashedIds.length === 0) {
            const emptyEl = contentEl.createDiv('supernote-empty-state');
            const iconEl = emptyEl.createDiv('supernote-empty-state-icon');
            iconEl.setText('Bin is empty');
            emptyEl.createDiv({ text: 'No notes in trash' });
        } else {
            // Scrollable list container
            const listContainer = contentEl.createDiv('supernote-scroll-container supernote-scroll-short');
            this.createTrashList(listContainer);

            // Restore all button
            const restoreAllContainer = contentEl.createDiv('supernote-restore-all-container');

            const restoreAllBtn = restoreAllContainer.createEl('button', {
                text: 'Restore all',
                cls: 'mod-cta'
            });
            restoreAllBtn.onclick = () => {
                this.onRestoreAll();
                new Notice(`Restored ${this.trashedIds.length} note(s)`);
                this.close();
            };
        }

        // Close button
        const buttonContainer = contentEl.createDiv('modal-button-container supernote-buttons-right');

        const closeButton = buttonContainer.createEl('button', { text: 'Close' });
        closeButton.onclick = () => this.close();
    }

    private createTrashList(container: HTMLElement): void {
        const list = container.createDiv('supernote-trash-list');

        // If we have note details, show them; otherwise show IDs
        if (this.trashedNotes.length > 0) {
            this.trashedNotes.forEach(note => {
                this.createNoteItem(list, note);
            });
        } else {
            // Fallback to showing just IDs
            this.trashedIds.forEach(id => {
                this.createIdItem(list, id);
            });
        }
    }

    private createNoteItem(container: HTMLElement, note: SupernoteFile): void {
        const item = container.createDiv('supernote-trash-item');

        // Note info
        const infoDiv = item.createDiv('supernote-trash-item-info');

        infoDiv.createEl('div', { text: note.name, cls: 'supernote-trash-item-name' });
        infoDiv.createEl('div', { text: note.path, cls: 'supernote-trash-item-path' });

        // Restore button
        const restoreBtn = item.createEl('button', { text: 'Restore', cls: 'supernote-restore-btn' });
        restoreBtn.onclick = () => {
            this.onRestore(note.id);
            item.remove();
            new Notice(`Restored: ${note.name}`);

            // Update count and check if empty
            this.trashedIds = this.trashedIds.filter(id => id !== note.id);
            if (this.trashedIds.length === 0) {
                this.close();
                new Notice('All notes restored');
            }
        };
    }

    private createIdItem(container: HTMLElement, id: string): void {
        const item = container.createDiv('supernote-trash-item');

        // ID info
        const infoDiv = item.createDiv('supernote-trash-item-info');

        infoDiv.createEl('div', { text: `ID: ${this.truncateId(id)}`, cls: 'supernote-trash-item-id' });
        infoDiv.title = id;

        // Restore button
        const restoreBtn = item.createEl('button', { text: 'Restore', cls: 'supernote-restore-btn' });
        restoreBtn.onclick = () => {
            this.onRestore(id);
            item.remove();
            new Notice(`Restored note ID: ${this.truncateId(id)}`);

            // Update count and check if empty
            this.trashedIds = this.trashedIds.filter(i => i !== id);
            if (this.trashedIds.length === 0) {
                this.close();
                new Notice('All notes restored');
            }
        };
    }

    private truncateId(id: string, maxLength: number = 20): string {
        if (id.length <= maxLength) return id;
        return `${id.slice(0, 8)}...${id.slice(-8)}`;
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
