import { App, Modal, Notice, setIcon } from 'obsidian';
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
        this.modalEl.style.width = '700px';
        this.modalEl.style.maxWidth = '90%';
        this.titleEl.setText('Manage Trashed Notes');

        // Description
        contentEl.createEl('p', {
            text: 'These notes have been excluded from sync. Restore them to include them in future syncs.',
            cls: 'setting-item-description'
        }).style.marginBottom = '15px';

        // Count
        const countEl = contentEl.createEl('p');
        countEl.innerHTML = `<strong>${this.trashedIds.length}</strong> note(s) currently trashed`;
        countEl.style.marginBottom = '20px';

        if (this.trashedIds.length === 0) {
            const emptyEl = contentEl.createDiv('trash-empty');
            emptyEl.style.textAlign = 'center';
            emptyEl.style.padding = '40px';
            emptyEl.style.color = 'var(--text-muted)';
            emptyEl.innerHTML = `
                <div style="font-size: 3em; margin-bottom: 10px;">🗑️</div>
                <div>No notes in trash</div>
            `;
        } else {
            // Scrollable list container
            const listContainer = contentEl.createDiv('trash-list-container');
            listContainer.style.maxHeight = '400px';
            listContainer.style.overflowY = 'auto';
            listContainer.style.border = '1px solid var(--background-modifier-border)';
            listContainer.style.borderRadius = '6px';

            this.createTrashList(listContainer);

            // Restore All button
            const restoreAllContainer = contentEl.createDiv();
            restoreAllContainer.style.marginTop = '15px';
            restoreAllContainer.style.textAlign = 'right';

            const restoreAllBtn = restoreAllContainer.createEl('button', {
                text: 'Restore All',
                cls: 'mod-cta'
            });
            restoreAllBtn.onclick = () => {
                this.onRestoreAll();
                new Notice(`Restored ${this.trashedIds.length} note(s)`);
                this.close();
            };
        }

        // Close button
        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
        buttonContainer.style.marginTop = '20px';
        buttonContainer.style.display = 'flex';
        buttonContainer.style.justifyContent = 'flex-end';

        const closeButton = buttonContainer.createEl('button', { text: 'Close' });
        closeButton.onclick = () => this.close();
    }

    private createTrashList(container: HTMLElement): void {
        const list = container.createDiv('trash-list');

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
        const item = container.createDiv('trash-item');
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.justifyContent = 'space-between';
        item.style.padding = '12px 15px';
        item.style.borderBottom = '1px solid var(--background-modifier-border)';

        // Note info
        const infoDiv = item.createDiv('trash-item-info');
        infoDiv.style.flex = '1';
        infoDiv.style.minWidth = '0';

        const nameEl = infoDiv.createEl('div', { text: note.name });
        nameEl.style.fontWeight = '500';
        nameEl.style.marginBottom = '4px';
        nameEl.style.overflow = 'hidden';
        nameEl.style.textOverflow = 'ellipsis';
        nameEl.style.whiteSpace = 'nowrap';

        const pathEl = infoDiv.createEl('div', { text: note.path });
        pathEl.style.fontSize = '0.85em';
        pathEl.style.color = 'var(--text-muted)';
        pathEl.style.overflow = 'hidden';
        pathEl.style.textOverflow = 'ellipsis';
        pathEl.style.whiteSpace = 'nowrap';

        // Restore button
        const restoreBtn = item.createEl('button', { text: 'Restore' });
        restoreBtn.style.marginLeft = '15px';
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
        const item = container.createDiv('trash-item');
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.justifyContent = 'space-between';
        item.style.padding = '12px 15px';
        item.style.borderBottom = '1px solid var(--background-modifier-border)';

        // ID info
        const infoDiv = item.createDiv('trash-item-info');
        infoDiv.style.flex = '1';
        infoDiv.style.minWidth = '0';

        const idEl = infoDiv.createEl('div', { text: `ID: ${this.truncateId(id)}` });
        idEl.style.fontFamily = 'var(--font-monospace)';
        idEl.style.fontSize = '0.9em';
        idEl.title = id;

        // Restore button
        const restoreBtn = item.createEl('button', { text: 'Restore' });
        restoreBtn.style.marginLeft = '15px';
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
