import { App, Modal, Notice, setIcon } from 'obsidian';
import { SupernoteFile, LocalNoteFile } from '../api/types';
import { formatFileSize } from '../utils/markdown';

export type ActionType = 'import' | 'update' | 'export';

/**
 * Interactive confirmation modal with table selection, keyboard navigation, and trash functionality
 */
export class ConfirmationModal extends Modal {
    private notes: SupernoteFile[];
    private selectedNotes: Set<string>;
    private actionType: ActionType;
    private onConfirm: (selectedNotes: SupernoteFile[]) => void;
    private onCancel: () => void;
    private onTrash: (noteId: string) => void;

    // For showing modification status
    private lastSync?: number;
    private localNotes?: Map<string, LocalNoteFile>;

    // Keyboard navigation
    private currentRowIndex: number = 0;
    private tableRows: HTMLTableRowElement[] = [];

    // Button references
    private confirmButton: HTMLButtonElement | null = null;
    private selectAllBtn: HTMLButtonElement | null = null;
    private deselectAllBtn: HTMLButtonElement | null = null;
    private trashAllBtn: HTMLButtonElement | null = null;

    constructor(
        app: App,
        notes: SupernoteFile[],
        actionType: ActionType,
        onConfirm: (selectedNotes: SupernoteFile[]) => void,
        onCancel: () => void,
        onTrash: (noteId: string) => void,
        lastSync?: number,
        localNotes?: Map<string, LocalNoteFile>
    ) {
        super(app);
        this.notes = notes;
        this.actionType = actionType;
        this.lastSync = lastSync;
        this.localNotes = localNotes;
        this.onConfirm = onConfirm;
        this.onCancel = onCancel;
        this.onTrash = onTrash;

        // Start with all notes selected
        this.selectedNotes = new Set(notes.map(n => n.id));
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();

        // Modal styling
        this.modalEl.addClass('supernote-modal-wide');
        this.titleEl.setText(this.getActionTitle());

        // Description
        contentEl.createEl('p', {
            text: this.getActionDescription(),
            cls: 'supernote-description'
        });

        // Keyboard help
        contentEl.createEl('p', {
            text: 'Keyboard: up/down to navigate, space/enter to toggle selection',
            cls: 'supernote-help-text'
        });

        // Scrollable table container
        const tableContainer = contentEl.createDiv('supernote-scroll-container');
        tableContainer.appendChild(this.createNotesTable());

        // Button container
        const buttonContainer = contentEl.createDiv('supernote-button-container');

        // Left side buttons
        const leftButtons = buttonContainer.createDiv('supernote-button-group');

        this.selectAllBtn = leftButtons.createEl('button', {
            text: 'Select all',
            cls: 'mod-muted'
        });
        this.selectAllBtn.onclick = () => this.selectAll();

        this.deselectAllBtn = leftButtons.createEl('button', {
            text: 'Deselect all',
            cls: 'mod-muted'
        });
        this.deselectAllBtn.onclick = () => this.deselectAll();

        // Trash All Selected button (only for import)
        if (this.actionType === 'import') {
            this.trashAllBtn = leftButtons.createEl('button', {
                text: 'Trash selected',
                cls: 'mod-warning supernote-text-error'
            });
            this.trashAllBtn.onclick = () => this.handleTrashAllSelected();
        }

        // Right side buttons
        const rightButtons = buttonContainer.createDiv('supernote-button-group');

        const cancelButton = rightButtons.createEl('button', { text: 'Cancel' });
        cancelButton.onclick = () => {
            this.close();
            this.onCancel();
        };

        this.confirmButton = rightButtons.createEl('button', {
            text: `Confirm (${this.selectedNotes.size} selected)`,
            cls: 'mod-cta'
        });
        this.confirmButton.onclick = () => {
            const selected = this.notes.filter(n => this.selectedNotes.has(n.id));
            this.close();
            this.onConfirm(selected);
        };

        this.updateButtonStates();

        // Register keyboard handlers
        this.registerKeyboardHandlers();
    }

    private createNotesTable(): HTMLTableElement {
        const table = document.createElement('table');
        table.addClass('supernote-table');

        // Determine if we should show the status column
        const showStatusColumn = this.actionType === 'update' && this.lastSync && this.localNotes;

        // Header
        const thead = table.createTHead();
        const headerRow = thead.insertRow();

        const headers = showStatusColumn
            ? ['', 'Name', 'Path', 'Modified', 'Pages', 'Size', 'Status']
            : ['', 'Name', 'Path', 'Modified', 'Pages', 'Size'];

        headers.forEach((headerText, index) => {
            const th = document.createElement('th');
            th.textContent = headerText;
            if (index === 0) {
                th.addClass('center');
            }
            headerRow.appendChild(th);
        });

        // Body
        const tbody = table.createTBody();
        this.tableRows = [];

        this.notes.forEach((note, index) => {
            const row = tbody.insertRow();
            this.tableRows.push(row);

            // Checkbox + Trash cell
            const checkboxCell = row.insertCell();
            checkboxCell.addClass('supernote-cell-checkbox');

            const cellWrapper = checkboxCell.createDiv('supernote-checkbox-wrapper');

            // Checkbox
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = true;
            checkbox.value = note.id;
            checkbox.addClass('supernote-checkbox');
            checkbox.onchange = () => this.toggleSelection(note.id);
            cellWrapper.appendChild(checkbox);

            // Trash icon (hidden by default)
            const trashIcon = cellWrapper.createSpan('supernote-trash-icon');
            trashIcon.setAttribute('data-trash-icon', 'true');
            trashIcon.setAttribute('aria-label', 'Exclude from future syncs');
            trashIcon.onclick = (e) => {
                e.stopPropagation();
                this.handleTrash(note.id);
            };
            setIcon(trashIcon, 'trash-2');

            // Row hover handlers
            row.onmouseenter = () => {
                if (this.currentRowIndex !== index) {
                    row.addClass('is-selected');
                }
            };
            row.onmouseleave = () => {
                if (this.currentRowIndex !== index) {
                    row.removeClass('is-selected');
                }
            };

            // Row click handler
            row.onclick = (e) => {
                const target = e.target as HTMLElement;
                if (target !== checkbox && !trashIcon.contains(target)) {
                    this.setCurrentRow(index);
                    checkbox.checked = !checkbox.checked;
                    this.toggleSelection(note.id);
                } else {
                    this.setCurrentRow(index);
                }
            };

            // Name cell
            const nameCell = row.insertCell();
            nameCell.textContent = note.name;
            nameCell.addClass('supernote-cell-name');

            // Path cell
            const pathCell = row.insertCell();
            pathCell.textContent = this.truncatePath(note.path);
            pathCell.title = note.path;
            pathCell.addClass('supernote-cell-path');

            // Modified date cell
            const dateCell = row.insertCell();
            dateCell.textContent = this.formatDate(note.modifiedAt);

            // Pages cell
            const pagesCell = row.insertCell();
            pagesCell.textContent = note.pageCount?.toString() || '-';
            pagesCell.addClass('supernote-cell-center');

            // Size cell
            const sizeCell = row.insertCell();
            sizeCell.textContent = formatFileSize(note.size);
            sizeCell.addClass('supernote-cell-right');

            // Status cell (for update mode)
            if (showStatusColumn) {
                const statusCell = row.insertCell();
                const localFile = this.localNotes!.get(note.id);
                const isModified = localFile && localFile.mtime && this.lastSync && localFile.mtime > this.lastSync;

                if (isModified) {
                    statusCell.textContent = 'Modified';
                    statusCell.addClass('supernote-status-modified');
                } else {
                    statusCell.textContent = 'Unmodified';
                    statusCell.addClass('supernote-text-muted');
                }
            }
        });

        // Set initial highlight
        if (this.tableRows.length > 0) {
            this.setCurrentRow(0);
        }

        return table;
    }

    private registerKeyboardHandlers(): void {
        this.scope.register([], 'ArrowDown', (evt) => {
            evt.preventDefault();
            if (this.currentRowIndex < this.tableRows.length - 1) {
                this.setCurrentRow(this.currentRowIndex + 1);
            }
            return false;
        });

        this.scope.register([], 'ArrowUp', (evt) => {
            evt.preventDefault();
            if (this.currentRowIndex > 0) {
                this.setCurrentRow(this.currentRowIndex - 1);
            }
            return false;
        });

        this.scope.register([], ' ', (evt) => {
            evt.preventDefault();
            this.toggleCurrentRow();
            return false;
        });

        this.scope.register([], 'Enter', (evt) => {
            evt.preventDefault();
            this.toggleCurrentRow();
            return false;
        });
    }

    private setCurrentRow(index: number): void {
        // Remove highlight from previous row
        if (this.tableRows[this.currentRowIndex]) {
            this.tableRows[this.currentRowIndex].removeClass('is-selected');
        }

        this.currentRowIndex = index;

        // Highlight new current row
        if (this.tableRows[this.currentRowIndex]) {
            this.tableRows[this.currentRowIndex].addClass('is-selected');
            this.tableRows[this.currentRowIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    private toggleCurrentRow(): void {
        if (this.tableRows[this.currentRowIndex]) {
            const checkbox = this.tableRows[this.currentRowIndex].querySelector('input[type="checkbox"]') as HTMLInputElement;
            if (checkbox) {
                checkbox.checked = !checkbox.checked;
                this.toggleSelection(checkbox.value);
            }
        }
    }

    private toggleSelection(noteId: string): void {
        if (this.selectedNotes.has(noteId)) {
            this.selectedNotes.delete(noteId);
        } else {
            this.selectedNotes.add(noteId);
        }
        this.updateButtonStates();
    }

    private selectAll(): void {
        this.selectedNotes = new Set(this.notes.map(n => n.id));
        const checkboxes = this.containerEl.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach((cb) => {
            (cb as HTMLInputElement).checked = true;
        });
        this.updateButtonStates();
    }

    private deselectAll(): void {
        this.selectedNotes.clear();
        const checkboxes = this.containerEl.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach((cb) => {
            (cb as HTMLInputElement).checked = false;
        });
        this.updateButtonStates();
    }

    private updateButtonStates(): void {
        const selectedCount = this.selectedNotes.size;
        const totalCount = this.notes.length;

        if (this.confirmButton) {
            this.confirmButton.textContent = `Confirm (${selectedCount} selected)`;
            this.confirmButton.disabled = selectedCount === 0;
        }

        if (this.selectAllBtn) {
            this.selectAllBtn.disabled = selectedCount === totalCount;
        }

        if (this.deselectAllBtn) {
            this.deselectAllBtn.disabled = selectedCount === 0;
        }

        if (this.trashAllBtn) {
            this.trashAllBtn.disabled = selectedCount === 0;
        }
    }

    private handleTrash(noteId: string): void {
        this.onTrash(noteId);
        this.selectedNotes.delete(noteId);
        this.notes = this.notes.filter(n => n.id !== noteId);

        // Find and remove the row
        const rowIndex = this.tableRows.findIndex(row => {
            const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
            return checkbox && checkbox.value === noteId;
        });

        if (rowIndex !== -1) {
            this.tableRows[rowIndex].remove();
            this.tableRows.splice(rowIndex, 1);

            // Adjust current row index
            if (this.currentRowIndex >= this.tableRows.length) {
                this.currentRowIndex = Math.max(0, this.tableRows.length - 1);
            }

            if (this.tableRows.length > 0) {
                this.setCurrentRow(this.currentRowIndex);
            }
        }

        this.updateButtonStates();

        if (this.notes.length === 0) {
            this.close();
        }
    }

    private handleTrashAllSelected(): void {
        const selectedIds = Array.from(this.selectedNotes);

        if (selectedIds.length === 0) {
            new Notice('No notes selected');
            return;
        }

        // Create confirmation modal
        const confirmModal = new Modal(this.app);
        confirmModal.titleEl.setText('Confirm trash selected');

        const { contentEl } = confirmModal;
        contentEl.empty();

        contentEl.createEl('p', {
            text: `Are you sure you want to trash ${selectedIds.length} selected note(s)?`
        });
        contentEl.createEl('p', {
            text: 'They will be permanently excluded from all future syncs.',
            cls: 'setting-item-description'
        });

        const buttonContainer = contentEl.createDiv('modal-button-container supernote-buttons-right');

        const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelBtn.onclick = () => confirmModal.close();

        const confirmBtn = buttonContainer.createEl('button', {
            text: 'Trash all',
            cls: 'mod-warning'
        });
        confirmBtn.onclick = () => {
            selectedIds.forEach(id => this.onTrash(id));
            this.notes = this.notes.filter(n => !selectedIds.includes(n.id));
            this.selectedNotes.clear();

            // Rebuild the table
            const tableContainer = this.contentEl.querySelector('.supernote-scroll-container');
            if (tableContainer) {
                tableContainer.empty();
                if (this.notes.length > 0) {
                    tableContainer.appendChild(this.createNotesTable());
                }
            }

            this.updateButtonStates();
            confirmModal.close();
            new Notice(`Trashed ${selectedIds.length} note(s)`);

            if (this.notes.length === 0) {
                this.close();
            }
        };

        confirmModal.open();
    }

    private getActionTitle(): string {
        switch (this.actionType) {
            case 'import': return 'Import new notes';
            case 'update': return 'Update existing notes';
            case 'export': return 'Bulk export all notes';
            default: return 'Confirm action';
        }
    }

    private getActionDescription(): string {
        switch (this.actionType) {
            case 'import':
                return `${this.notes.length} new note(s) found. Select which ones to import:`;
            case 'update':
                return `${this.notes.length} note(s) can be updated. Select which ones to update:`;
            case 'export':
                return `${this.notes.length} note(s) will be exported. Existing files will be overwritten.`;
            default:
                return `${this.notes.length} note(s) will be affected:`;
        }
    }

    private formatDate(dateString: string): string {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    }

    private truncatePath(path: string, maxLength: number = 35): string {
        if (path.length <= maxLength) return path;
        const start = path.slice(0, 12);
        const end = path.slice(-18);
        return `${start}...${end}`;
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
