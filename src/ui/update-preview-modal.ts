import { App, Modal, Setting } from 'obsidian';
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
        this.modalEl.addClass('supernote-modal-xl');
        this.titleEl.setText('Update preview');

        // Summary section
        const summaryEl = contentEl.createDiv('supernote-summary');

        // Update mode label
        new Setting(summaryEl)
            .setHeading()
            .setName(`Update mode: ${this.getUpdateModeLabel()}`)
            .setClass('supernote-preview-mode');

        // Additional details
        const details: string[] = [];

        if (this.updateOptions.mode === 'specific-frontmatter' && this.updateOptions.specificFields) {
            details.push(`Fields: ${this.updateOptions.specificFields.join(', ')}`);
        }

        if (this.updateOptions.preserveCustomFields) {
            details.push('Custom fields will be preserved');
        }

        details.push(`Tags: ${this.updateOptions.arrayMergeStrategy.tags === 'merge' ? 'Merge' : 'Replace'}`);

        summaryEl.createDiv({
            text: details.join(' - '),
            cls: 'setting-item-description'
        });

        // Statistics
        const filesWithChanges = this.notePreviews.filter(p => p.preview.hasChanges).length;
        const totalFiles = this.notePreviews.length;

        const statsEl = contentEl.createDiv('supernote-stats-text');
        statsEl.createEl('strong', {
            text: `${filesWithChanges} of ${totalFiles} file(s) will be updated`,
            cls: 'supernote-text-accent'
        });

        // Scrollable table container
        const tableContainer = contentEl.createDiv('supernote-scroll-container');
        tableContainer.appendChild(this.createPreviewTable());

        // Buttons
        const buttonContainer = contentEl.createDiv('modal-button-container supernote-buttons-right');

        const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelButton.onclick = () => {
            this.close();
            this.onCancel();
        };

        const continueButton = buttonContainer.createEl('button', {
            text: 'Continue to selection',
            cls: 'mod-cta'
        });
        continueButton.onclick = () => {
            this.close();
            this.onContinue();
        };
    }

    private createPreviewTable(): HTMLTableElement {
        const table = document.createElement('table');
        table.addClass('supernote-table');

        // Header
        const thead = table.createTHead();
        const headerRow = thead.insertRow();
        const headers = ['File', 'Frontmatter changes', 'Content', 'Custom fields'];

        headers.forEach(headerText => {
            const th = document.createElement('th');
            th.textContent = headerText;
            headerRow.appendChild(th);
        });

        // Body
        const tbody = table.createTBody();

        this.notePreviews.forEach((preview, index) => {
            const row = tbody.insertRow();
            if (index % 2 === 1) {
                row.addClass('is-striped');
            }

            // File name
            const fileCell = row.insertCell();
            fileCell.textContent = preview.note.name;
            fileCell.title = preview.note.name;
            fileCell.addClass('supernote-cell-truncate');

            // Frontmatter changes
            const fmCell = row.insertCell();

            if (preview.preview.frontmatterChanges.length > 0) {
                const changesList = fmCell.createDiv('supernote-changes-list');

                const fields = preview.preview.frontmatterChanges.map(c => c.field);
                const fieldsText = fields.length <= 3
                    ? fields.join(', ')
                    : `${fields.slice(0, 3).join(', ')} +${fields.length - 3} more`;

                changesList.createSpan({ text: fieldsText, cls: 'supernote-text-accent' });
                changesList.title = fields.join(', ');
            } else {
                fmCell.textContent = '-';
                fmCell.addClass('supernote-text-muted');
            }

            // Content changed
            const contentCell = row.insertCell();

            if (preview.preview.contentChanged) {
                contentCell.createSpan({ text: 'Will update', cls: 'supernote-text-orange' });
            } else {
                contentCell.textContent = 'No change';
                contentCell.addClass('supernote-text-muted');
            }

            // Custom fields preserved
            const customCell = row.insertCell();

            if (preview.preview.customFieldsPreserved.length > 0) {
                const preserved = preview.preview.customFieldsPreserved;
                const text = preserved.length <= 2
                    ? preserved.join(', ')
                    : `${preserved.slice(0, 2).join(', ')} +${preserved.length - 2}`;

                customCell.createSpan({ text: text, cls: 'supernote-text-green' });
                customCell.title = preserved.join(', ');
            } else {
                customCell.textContent = '-';
                customCell.addClass('supernote-text-muted');
            }
        });

        return table;
    }

    private getUpdateModeLabel(): string {
        switch (this.updateOptions.mode) {
            case 'all': return 'Update everything';
            case 'frontmatter-only': return 'Frontmatter only';
            case 'content-only': return 'Content only';
            case 'specific-frontmatter': return 'Specific frontmatter fields';
            default: return 'Unknown';
        }
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
