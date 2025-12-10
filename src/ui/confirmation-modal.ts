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
        this.modalEl.style.width = '85%';
        this.modalEl.style.maxWidth = '1100px';
        this.titleEl.setText(this.getActionTitle());

        // Description
        const descEl = contentEl.createEl('p', {
            text: this.getActionDescription(),
            cls: 'confirmation-modal-desc'
        });
        descEl.style.marginBottom = '10px';
        descEl.style.color = 'var(--text-muted)';

        // Keyboard help
        const helpText = contentEl.createEl('p', {
            text: 'Keyboard: ↑↓ to navigate, Space/Enter to toggle selection',
            cls: 'setting-item-description'
        });
        helpText.style.marginBottom = '15px';
        helpText.style.fontSize = '0.85em';
        helpText.style.fontStyle = 'italic';

        // Scrollable table container
        const tableContainer = contentEl.createDiv('confirmation-table-container');
        tableContainer.style.maxHeight = '450px';
        tableContainer.style.overflowY = 'auto';
        tableContainer.style.border = '1px solid var(--background-modifier-border)';
        tableContainer.style.borderRadius = '6px';

        tableContainer.appendChild(this.createNotesTable());

        // Button container
        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
        buttonContainer.style.marginTop = '20px';
        buttonContainer.style.display = 'flex';
        buttonContainer.style.gap = '10px';
        buttonContainer.style.justifyContent = 'space-between';
        buttonContainer.style.flexWrap = 'wrap';

        // Left side buttons
        const leftButtons = buttonContainer.createDiv();
        leftButtons.style.display = 'flex';
        leftButtons.style.gap = '8px';

        this.selectAllBtn = leftButtons.createEl('button', {
            text: 'Select All',
            cls: 'mod-muted'
        });
        this.selectAllBtn.onclick = () => this.selectAll();

        this.deselectAllBtn = leftButtons.createEl('button', {
            text: 'Deselect All',
            cls: 'mod-muted'
        });
        this.deselectAllBtn.onclick = () => this.deselectAll();

        // Trash All Selected button (only for import)
        if (this.actionType === 'import') {
            this.trashAllBtn = leftButtons.createEl('button', {
                text: 'Trash Selected',
                cls: 'mod-warning'
            });
            this.trashAllBtn.style.color = 'var(--text-error)';
            this.trashAllBtn.onclick = () => this.handleTrashAllSelected();
        }

        // Right side buttons
        const rightButtons = buttonContainer.createDiv();
        rightButtons.style.display = 'flex';
        rightButtons.style.gap = '8px';

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
        table.style.width = '100%';
        table.style.borderCollapse = 'collapse';

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
            th.style.textAlign = index === 0 ? 'center' : 'left';
            th.style.padding = '10px 12px';
            th.style.borderBottom = '2px solid var(--background-modifier-border)';
            th.style.fontWeight = '600';
            th.style.fontSize = '0.85em';
            th.style.position = 'sticky';
            th.style.top = '0';
            th.style.backgroundColor = 'var(--background-primary)';
            th.style.zIndex = '10';
            
            if (headerText) {
                th.style.textTransform = 'uppercase';
                th.style.letterSpacing = '0.5px';
                th.style.color = 'var(--text-muted)';
            }
            
            headerRow.appendChild(th);
        });

        // Body
        const tbody = table.createTBody();
        this.tableRows = [];

        this.notes.forEach((note, index) => {
            const row = tbody.insertRow();
            this.tableRows.push(row);
            row.style.cursor = 'pointer';
            row.style.transition = 'background-color 0.15s ease';

            // Checkbox + Trash cell
            const checkboxCell = row.insertCell();
            checkboxCell.style.padding = '10px 12px';
            checkboxCell.style.borderBottom = '1px solid var(--background-modifier-border)';
            checkboxCell.style.textAlign = 'center';
            checkboxCell.style.width = '70px';

            const cellWrapper = document.createElement('div');
            cellWrapper.style.display = 'flex';
            cellWrapper.style.gap = '8px';
            cellWrapper.style.alignItems = 'center';
            cellWrapper.style.justifyContent = 'center';

            // Checkbox
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = true;
            checkbox.value = note.id;
            checkbox.style.cursor = 'pointer';
            checkbox.style.width = '16px';
            checkbox.style.height = '16px';
            checkbox.onchange = () => this.toggleSelection(note.id);
            cellWrapper.appendChild(checkbox);

            // Trash icon (hidden by default)
            const trashIcon = document.createElement('span');
            trashIcon.style.cursor = 'pointer';
            trashIcon.style.color = 'var(--text-muted)';
            trashIcon.style.opacity = '0.6';
            trashIcon.style.visibility = 'hidden';
            trashIcon.style.transition = 'opacity 0.15s, color 0.15s';
            trashIcon.setAttribute('data-trash-icon', 'true');
            trashIcon.setAttribute('aria-label', 'Exclude from future syncs');
            
            trashIcon.onmouseenter = () => {
                trashIcon.style.opacity = '1';
                trashIcon.style.color = 'var(--text-error)';
            };
            trashIcon.onmouseleave = () => {
                trashIcon.style.opacity = '0.6';
                trashIcon.style.color = 'var(--text-muted)';
            };
            trashIcon.onclick = (e) => {
                e.stopPropagation();
                this.handleTrash(note.id);
            };
            setIcon(trashIcon, 'trash-2');
            cellWrapper.appendChild(trashIcon);

            checkboxCell.appendChild(cellWrapper);

            // Row hover handlers
            row.onmouseenter = () => {
                if (this.currentRowIndex !== index) {
                    row.style.backgroundColor = 'var(--background-secondary)';
                }
                const icon = row.querySelector('[data-trash-icon="true"]') as HTMLElement;
                if (icon) icon.style.visibility = 'visible';
            };
            row.onmouseleave = () => {
                if (this.currentRowIndex !== index) {
                    row.style.backgroundColor = '';
                }
                if (this.currentRowIndex !== index) {
                    const icon = row.querySelector('[data-trash-icon="true"]') as HTMLElement;
                    if (icon) icon.style.visibility = 'hidden';
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
            nameCell.style.padding = '10px 12px';
            nameCell.style.borderBottom = '1px solid var(--background-modifier-border)';
            nameCell.style.fontWeight = '500';

            // Path cell
            const pathCell = row.insertCell();
            pathCell.textContent = this.truncatePath(note.path);
            pathCell.title = note.path;
            pathCell.style.padding = '10px 12px';
            pathCell.style.borderBottom = '1px solid var(--background-modifier-border)';
            pathCell.style.color = 'var(--text-muted)';
            pathCell.style.fontSize = '0.9em';

            // Modified date cell
            const dateCell = row.insertCell();
            dateCell.textContent = this.formatDate(note.modifiedAt);
            dateCell.style.padding = '10px 12px';
            dateCell.style.borderBottom = '1px solid var(--background-modifier-border)';

            // Pages cell
            const pagesCell = row.insertCell();
            pagesCell.textContent = note.pageCount?.toString() || '-';
            pagesCell.style.padding = '10px 12px';
            pagesCell.style.borderBottom = '1px solid var(--background-modifier-border)';
            pagesCell.style.textAlign = 'center';

            // Size cell
            const sizeCell = row.insertCell();
            sizeCell.textContent = formatFileSize(note.size);
            sizeCell.style.padding = '10px 12px';
            sizeCell.style.borderBottom = '1px solid var(--background-modifier-border)';
            sizeCell.style.textAlign = 'right';

            // Status cell (for update mode)
            if (showStatusColumn) {
                const statusCell = row.insertCell();
                const localFile = this.localNotes!.get(note.id);
                const isModified = localFile && localFile.mtime && this.lastSync && localFile.mtime > this.lastSync;

                if (isModified) {
                    statusCell.textContent = 'Modified';
                    statusCell.style.color = 'var(--text-warning)';
                    statusCell.style.fontWeight = '600';
                } else {
                    statusCell.textContent = 'Unmodified';
                    statusCell.style.color = 'var(--text-muted)';
                }
                statusCell.style.padding = '10px 12px';
                statusCell.style.borderBottom = '1px solid var(--background-modifier-border)';
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
            this.tableRows[this.currentRowIndex].style.backgroundColor = '';
            const prevIcon = this.tableRows[this.currentRowIndex].querySelector('[data-trash-icon="true"]') as HTMLElement;
            if (prevIcon) prevIcon.style.visibility = 'hidden';
        }

        this.currentRowIndex = index;

        // Highlight new current row
        if (this.tableRows[this.currentRowIndex]) {
            this.tableRows[this.currentRowIndex].style.backgroundColor = 'var(--background-modifier-hover)';
            this.tableRows[this.currentRowIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            const currentIcon = this.tableRows[this.currentRowIndex].querySelector('[data-trash-icon="true"]') as HTMLElement;
            if (currentIcon) currentIcon.style.visibility = 'visible';
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
        confirmModal.titleEl.setText('Confirm Trash Selected');

        const { contentEl } = confirmModal;
        contentEl.empty();

        contentEl.createEl('p', {
            text: `Are you sure you want to trash ${selectedIds.length} selected note(s)?`
        });
        contentEl.createEl('p', {
            text: 'They will be permanently excluded from all future syncs.',
            cls: 'setting-item-description'
        });

        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
        buttonContainer.style.display = 'flex';
        buttonContainer.style.gap = '10px';
        buttonContainer.style.justifyContent = 'flex-end';
        buttonContainer.style.marginTop = '20px';

        const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelBtn.onclick = () => confirmModal.close();

        const confirmBtn = buttonContainer.createEl('button', {
            text: 'Trash All',
            cls: 'mod-warning'
        });
        confirmBtn.onclick = () => {
            selectedIds.forEach(id => this.onTrash(id));
            this.notes = this.notes.filter(n => !selectedIds.includes(n.id));
            this.selectedNotes.clear();

            // Rebuild the table
            const tableContainer = this.contentEl.querySelector('.confirmation-table-container');
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
            case 'import': return 'Import New Notes';
            case 'update': return 'Update Existing Notes';
            case 'export': return 'Bulk Export All Notes';
            default: return 'Confirm Action';
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
