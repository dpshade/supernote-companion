import { App, Modal } from 'obsidian';
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
        this.modalEl.style.width = '80%';
        this.modalEl.style.maxWidth = '1000px';
        this.titleEl.setText('Sync Status');

        // Summary section
        const total = this.status.new.length + this.status.updated.length + this.status.synced.length;
        const summaryEl = contentEl.createEl('div', { cls: 'sync-status-summary' });
        summaryEl.style.marginBottom = '20px';
        summaryEl.style.padding = '15px';
        summaryEl.style.backgroundColor = 'var(--background-secondary)';
        summaryEl.style.borderRadius = '8px';

        summaryEl.innerHTML = `
            <div style="display: flex; justify-content: space-around; text-align: center;">
                <div>
                    <div style="font-size: 2em; font-weight: bold;">${total}</div>
                    <div style="color: var(--text-muted);">Total Notes</div>
                </div>
                <div>
                    <div style="font-size: 2em; font-weight: bold; color: var(--text-accent);">${this.status.new.length}</div>
                    <div style="color: var(--text-muted);">New</div>
                </div>
                <div>
                    <div style="font-size: 2em; font-weight: bold; color: var(--color-orange);">${this.status.updated.length}</div>
                    <div style="color: var(--text-muted);">Updated</div>
                </div>
                <div>
                    <div style="font-size: 2em; font-weight: bold; color: var(--color-green);">${this.status.synced.length}</div>
                    <div style="color: var(--text-muted);">Synced</div>
                </div>
            </div>
        `;

        // Scrollable content area
        const scrollContainer = contentEl.createDiv('sync-status-scroll');
        scrollContainer.style.maxHeight = '500px';
        scrollContainer.style.overflowY = 'auto';

        // New Notes Section
        if (this.status.new.length > 0) {
            this.createSection(scrollContainer, 'New Notes', this.status.new, 'var(--text-accent)');
        }

        // Updated Notes Section
        if (this.status.updated.length > 0) {
            this.createSection(scrollContainer, 'Updated Notes', this.status.updated, 'var(--color-orange)');
        }

        // Synced Notes Section (collapsed by default)
        if (this.status.synced.length > 0) {
            this.createCollapsibleSection(scrollContainer, 'Already Synced', this.status.synced, 'var(--color-green)');
        }

        // Close button
        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
        buttonContainer.style.marginTop = '20px';
        buttonContainer.style.display = 'flex';
        buttonContainer.style.justifyContent = 'flex-end';

        const closeButton = buttonContainer.createEl('button', { text: 'Close' });
        closeButton.onclick = () => this.close();
    }

    private createSection(
        container: HTMLElement,
        title: string,
        notes: SupernoteFile[],
        accentColor: string
    ): void {
        const section = container.createDiv('sync-status-section');
        section.style.marginBottom = '20px';

        const header = section.createEl('h3', { text: `${title} (${notes.length})` });
        header.style.borderLeft = `4px solid ${accentColor}`;
        header.style.paddingLeft = '10px';
        header.style.marginBottom = '10px';

        section.appendChild(this.createNotesTable(notes));
    }

    private createCollapsibleSection(
        container: HTMLElement,
        title: string,
        notes: SupernoteFile[],
        accentColor: string
    ): void {
        const section = container.createDiv('sync-status-section');
        section.style.marginBottom = '20px';

        const header = section.createEl('h3', { text: `▶ ${title} (${notes.length})` });
        header.style.borderLeft = `4px solid ${accentColor}`;
        header.style.paddingLeft = '10px';
        header.style.marginBottom = '10px';
        header.style.cursor = 'pointer';
        header.style.userSelect = 'none';

        const tableContainer = section.createDiv();
        tableContainer.style.display = 'none';
        tableContainer.appendChild(this.createNotesTable(notes));

        header.addEventListener('click', () => {
            const isHidden = tableContainer.style.display === 'none';
            tableContainer.style.display = isHidden ? 'block' : 'none';
            header.setText(`${isHidden ? '▼' : '▶'} ${title} (${notes.length})`);
        });
    }

    private createNotesTable(notes: SupernoteFile[]): HTMLTableElement {
        const table = document.createElement('table');
        table.style.width = '100%';
        table.style.borderCollapse = 'collapse';

        // Header
        const thead = table.createTHead();
        const headerRow = thead.insertRow();
        const headers = ['Name', 'Path', 'Modified', 'Pages', 'Size'];

        headers.forEach(headerText => {
            const th = document.createElement('th');
            th.textContent = headerText;
            th.style.textAlign = 'left';
            th.style.padding = '8px 12px';
            th.style.borderBottom = '2px solid var(--background-modifier-border)';
            th.style.fontWeight = '600';
            th.style.fontSize = '0.85em';
            th.style.textTransform = 'uppercase';
            th.style.letterSpacing = '0.5px';
            th.style.color = 'var(--text-muted)';
            headerRow.appendChild(th);
        });

        // Body
        const tbody = table.createTBody();
        notes.forEach((note, index) => {
            const row = tbody.insertRow();
            row.style.backgroundColor = index % 2 === 0 
                ? 'transparent' 
                : 'var(--background-secondary-alt)';

            // Name
            const nameCell = row.insertCell();
            nameCell.textContent = note.name;
            nameCell.style.padding = '10px 12px';
            nameCell.style.borderBottom = '1px solid var(--background-modifier-border)';
            nameCell.style.fontWeight = '500';

            // Path
            const pathCell = row.insertCell();
            pathCell.textContent = this.truncatePath(note.path);
            pathCell.title = note.path; // Full path on hover
            pathCell.style.padding = '10px 12px';
            pathCell.style.borderBottom = '1px solid var(--background-modifier-border)';
            pathCell.style.color = 'var(--text-muted)';
            pathCell.style.fontSize = '0.9em';

            // Modified date
            const dateCell = row.insertCell();
            dateCell.textContent = this.formatDate(note.modifiedAt);
            dateCell.style.padding = '10px 12px';
            dateCell.style.borderBottom = '1px solid var(--background-modifier-border)';

            // Pages
            const pagesCell = row.insertCell();
            pagesCell.textContent = note.pageCount?.toString() || '-';
            pagesCell.style.padding = '10px 12px';
            pagesCell.style.borderBottom = '1px solid var(--background-modifier-border)';
            pagesCell.style.textAlign = 'center';

            // Size
            const sizeCell = row.insertCell();
            sizeCell.textContent = formatFileSize(note.size);
            sizeCell.style.padding = '10px 12px';
            sizeCell.style.borderBottom = '1px solid var(--background-modifier-border)';
            sizeCell.style.textAlign = 'right';
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

    onClose(): void {
        this.contentEl.empty();
    }
}
