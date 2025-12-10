import { App, Modal } from 'obsidian';
import { NoteUpdatePreview, UpdateOptions } from '../api/types';

/**
 * Modal showing a preview of what will change during an update
 */
export class UpdatePreviewModal extends Modal {
    private notePreviews: NoteUpdatePreview[];
    private updateOptions: UpdateOptions;
    private onContinue: () => void;
    private onCancel: () => void;

    constructor(
        app: App,
        notePreviews: NoteUpdatePreview[],
        updateOptions: UpdateOptions,
        onContinue: () => void,
        onCancel: () => void
    ) {
        super(app);
        this.notePreviews = notePreviews;
        this.updateOptions = updateOptions;
        this.onContinue = onContinue;
        this.onCancel = onCancel;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();

        // Modal styling
        this.modalEl.style.width = '90%';
        this.modalEl.style.maxWidth = '1200px';
        this.titleEl.setText('Update Preview');

        // Summary section
        const summaryEl = contentEl.createDiv('update-preview-summary');
        summaryEl.style.marginBottom = '20px';
        summaryEl.style.padding = '15px';
        summaryEl.style.backgroundColor = 'var(--background-secondary)';
        summaryEl.style.borderRadius = '8px';

        // Update mode label
        const modeEl = summaryEl.createEl('h4', {
            text: `Update Mode: ${this.getUpdateModeLabel()}`
        });
        modeEl.style.margin = '0 0 10px 0';

        // Additional details
        const details: string[] = [];

        if (this.updateOptions.mode === 'specific-frontmatter' && this.updateOptions.specificFields) {
            details.push(`Fields: ${this.updateOptions.specificFields.join(', ')}`);
        }

        if (this.updateOptions.preserveCustomFields) {
            details.push('Custom fields will be preserved');
        }

        details.push(`Tags: ${this.updateOptions.arrayMergeStrategy.tags === 'merge' ? 'Merge' : 'Replace'}`);

        summaryEl.createEl('div', {
            text: details.join(' • '),
            cls: 'setting-item-description'
        });

        // Statistics
        const filesWithChanges = this.notePreviews.filter(p => p.preview.hasChanges).length;
        const totalFiles = this.notePreviews.length;

        const statsEl = contentEl.createDiv('update-preview-stats');
        statsEl.style.marginBottom = '15px';
        const statsText = statsEl.createEl('strong', { 
            text: `${filesWithChanges} of ${totalFiles} file(s) will be updated` 
        });
        statsText.style.color = 'var(--text-accent)';

        // Scrollable table container
        const tableContainer = contentEl.createDiv('update-preview-table-container');
        tableContainer.style.maxHeight = '450px';
        tableContainer.style.overflowY = 'auto';
        tableContainer.style.marginBottom = '20px';
        tableContainer.style.border = '1px solid var(--background-modifier-border)';
        tableContainer.style.borderRadius = '6px';

        tableContainer.appendChild(this.createPreviewTable());

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
        buttonContainer.style.display = 'flex';
        buttonContainer.style.gap = '10px';
        buttonContainer.style.justifyContent = 'flex-end';

        const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelButton.onclick = () => {
            this.close();
            this.onCancel();
        };

        const continueButton = buttonContainer.createEl('button', {
            text: 'Continue to Selection',
            cls: 'mod-cta'
        });
        continueButton.onclick = () => {
            this.close();
            this.onContinue();
        };
    }

    private createPreviewTable(): HTMLTableElement {
        const table = document.createElement('table');
        table.style.width = '100%';
        table.style.borderCollapse = 'collapse';

        // Header
        const thead = table.createTHead();
        const headerRow = thead.insertRow();
        const headers = ['File', 'Frontmatter Changes', 'Content', 'Custom Fields'];

        headers.forEach(headerText => {
            const th = document.createElement('th');
            th.textContent = headerText;
            th.style.textAlign = 'left';
            th.style.padding = '12px';
            th.style.borderBottom = '2px solid var(--background-modifier-border)';
            th.style.fontWeight = '600';
            th.style.fontSize = '0.85em';
            th.style.textTransform = 'uppercase';
            th.style.letterSpacing = '0.5px';
            th.style.color = 'var(--text-muted)';
            th.style.position = 'sticky';
            th.style.top = '0';
            th.style.backgroundColor = 'var(--background-primary)';
            th.style.zIndex = '10';
            headerRow.appendChild(th);
        });

        // Body
        const tbody = table.createTBody();

        this.notePreviews.forEach((preview, index) => {
            const row = tbody.insertRow();
            row.style.backgroundColor = index % 2 === 0 
                ? 'transparent' 
                : 'var(--background-secondary-alt)';

            // File name
            const fileCell = row.insertCell();
            fileCell.style.padding = '12px';
            fileCell.style.borderBottom = '1px solid var(--background-modifier-border)';
            fileCell.style.maxWidth = '300px';
            fileCell.style.overflow = 'hidden';
            fileCell.style.textOverflow = 'ellipsis';
            fileCell.style.whiteSpace = 'nowrap';
            fileCell.textContent = preview.note.name;
            fileCell.title = preview.note.name;

            // Frontmatter changes
            const fmCell = row.insertCell();
            fmCell.style.padding = '12px';
            fmCell.style.borderBottom = '1px solid var(--background-modifier-border)';

            if (preview.preview.frontmatterChanges.length > 0) {
                const changesList = document.createElement('div');
                changesList.style.fontSize = '0.9em';

                const fields = preview.preview.frontmatterChanges.map(c => c.field);
                const fieldsText = fields.length <= 3 
                    ? fields.join(', ')
                    : `${fields.slice(0, 3).join(', ')} +${fields.length - 3} more`;

                const span = changesList.createSpan({ text: fieldsText });
                span.style.color = 'var(--text-accent)';
                changesList.title = fields.join(', ');
                fmCell.appendChild(changesList);
            } else {
                fmCell.textContent = '-';
                fmCell.style.color = 'var(--text-muted)';
            }

            // Content changed
            const contentCell = row.insertCell();
            contentCell.style.padding = '12px';
            contentCell.style.borderBottom = '1px solid var(--background-modifier-border)';

            if (preview.preview.contentChanged) {
                const span = contentCell.createSpan({ text: 'Will update' });
                span.style.color = 'var(--color-orange)';
            } else {
                contentCell.textContent = 'No change';
                contentCell.style.color = 'var(--text-muted)';
            }

            // Custom fields preserved
            const customCell = row.insertCell();
            customCell.style.padding = '12px';
            customCell.style.borderBottom = '1px solid var(--background-modifier-border)';

            if (preview.preview.customFieldsPreserved.length > 0) {
                const preserved = preview.preview.customFieldsPreserved;
                const text = preserved.length <= 2
                    ? preserved.join(', ')
                    : `${preserved.slice(0, 2).join(', ')} +${preserved.length - 2}`;

                const span = customCell.createSpan({ text: text });
                span.style.color = 'var(--color-green)';
                customCell.title = preserved.join(', ');
            } else {
                customCell.textContent = '-';
                customCell.style.color = 'var(--text-muted)';
            }
        });

        return table;
    }

    private getUpdateModeLabel(): string {
        switch (this.updateOptions.mode) {
            case 'all': return 'Update Everything';
            case 'frontmatter-only': return 'Frontmatter Only';
            case 'content-only': return 'Content Only';
            case 'specific-frontmatter': return 'Specific Frontmatter Fields';
            default: return 'Unknown';
        }
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
