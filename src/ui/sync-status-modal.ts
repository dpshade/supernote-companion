import { App, Modal, Setting } from 'obsidian';
import { SupernoteFile, SyncStatus } from '../api/types';
import { formatFileSize } from '../utils/markdown';

/**
 * Read-only modal displaying the current sync status
 */
export class SyncStatusModal extends Modal {
    private status: SyncStatus;

    constructor(app: App, status: SyncStatus) {
        super(app);
        this.status = status;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();

        // Modal styling
        this.modalEl.addClass('supernote-modal-large');
        this.titleEl.setText('Sync status');

        // Summary section
        const total = this.status.new.length + this.status.updated.length + this.status.synced.length;
        const summaryEl = contentEl.createDiv('supernote-summary');

        this.createStatBox(summaryEl, String(total), 'Total notes');
        this.createStatBox(summaryEl, String(this.status.new.length), 'New', 'supernote-text-accent');
        this.createStatBox(summaryEl, String(this.status.updated.length), 'Updated', 'supernote-text-orange');
        this.createStatBox(summaryEl, String(this.status.synced.length), 'Synced', 'supernote-text-green');

        // Scrollable content area
        const scrollContainer = contentEl.createDiv('supernote-scroll-container supernote-scroll-tall');

        // New notes section
        if (this.status.new.length > 0) {
            this.createSection(scrollContainer, 'New notes', this.status.new, 'border-accent');
        }

        // Updated notes section
        if (this.status.updated.length > 0) {
            this.createSection(scrollContainer, 'Updated notes', this.status.updated, 'border-orange');
        }

        // Synced notes section (collapsed by default)
        if (this.status.synced.length > 0) {
            this.createCollapsibleSection(scrollContainer, 'Already synced', this.status.synced, 'border-green');
        }

        // Close button
        const buttonContainer = contentEl.createDiv('modal-button-container supernote-buttons-right');

        const closeButton = buttonContainer.createEl('button', { text: 'Close' });
        closeButton.onclick = () => this.close();
    }

    private createSection(
        container: HTMLElement,
        title: string,
        notes: SupernoteFile[],
        borderClass: string
    ): void {
        const section = container.createDiv('supernote-section');

        new Setting(section)
            .setHeading()
            .setName(`${title} (${notes.length})`)
            .setClass(`supernote-section-header ${borderClass}`);

        section.appendChild(this.createNotesTable(notes));
    }

    private createCollapsibleSection(
        container: HTMLElement,
        title: string,
        notes: SupernoteFile[],
        borderClass: string
    ): void {
        const section = container.createDiv('supernote-section');

        const headerSetting = new Setting(section)
            .setHeading()
            .setName(`${title} (${notes.length}) - click to expand`)
            .setClass(`supernote-section-header ${borderClass} supernote-collapsible-header`);

        const tableContainer = section.createDiv('supernote-collapsible-content');
        tableContainer.appendChild(this.createNotesTable(notes));

        headerSetting.settingEl.onclick = () => {
            tableContainer.toggleClass('is-open', !tableContainer.hasClass('is-open'));
            const isOpen = tableContainer.hasClass('is-open');
            headerSetting.setName(isOpen ? `${title} (${notes.length})` : `${title} (${notes.length}) - click to expand`);
        };
    }

    private createNotesTable(notes: SupernoteFile[]): HTMLTableElement {
        const table = document.createElement('table');
        table.addClass('supernote-table');

        // Header
        const thead = table.createTHead();
        const headerRow = thead.insertRow();
        const headers = ['Name', 'Path', 'Modified', 'Pages', 'Size'];

        headers.forEach(headerText => {
            const th = document.createElement('th');
            th.textContent = headerText;
            headerRow.appendChild(th);
        });

        // Body
        const tbody = table.createTBody();
        notes.forEach((note, index) => {
            const row = tbody.insertRow();
            if (index % 2 === 1) {
                row.addClass('is-striped');
            }

            // Name
            const nameCell = row.insertCell();
            nameCell.textContent = note.name;
            nameCell.addClass('supernote-cell-name');

            // Path
            const pathCell = row.insertCell();
            pathCell.textContent = this.truncatePath(note.path);
            pathCell.title = note.path;
            pathCell.addClass('supernote-cell-path');

            // Modified date
            const dateCell = row.insertCell();
            dateCell.textContent = this.formatDate(note.modifiedAt);

            // Pages
            const pagesCell = row.insertCell();
            pagesCell.textContent = note.pageCount?.toString() || '-';
            pagesCell.addClass('supernote-cell-center');

            // Size
            const sizeCell = row.insertCell();
            sizeCell.textContent = formatFileSize(note.size);
            sizeCell.addClass('supernote-cell-right');
        });

        return table;
    }

    private formatDate(dateString: string): string {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    }

    private truncatePath(path: string, maxLength: number = 40): string {
        if (path.length <= maxLength) return path;
        const start = path.slice(0, 15);
        const end = path.slice(-20);
        return `${start}...${end}`;
    }

    private createStatBox(container: HTMLElement, value: string, label: string, colorClass?: string): void {
        const box = container.createDiv('supernote-summary-item');
        box.createDiv({ text: value, cls: `supernote-summary-count ${colorClass ?? ''}` });
        box.createDiv({ text: label, cls: 'supernote-summary-label' });
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
