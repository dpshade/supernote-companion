import { Plugin, Notice } from 'obsidian';
import { SupernoteCompanionSettings, DEFAULT_SETTINGS } from './settings';
import { SupernoteAPIClient, MockSupernoteAPIClient } from './api/client';
import { SupernoteFile, LocalNoteFile, UpdateOptions, ExportOptions, NoteUpdatePreview } from './api/types';
import { SupernoteSettingTab } from './ui/settings-tab';
import { SyncStatusModal } from './ui/sync-status-modal';
import { ConfirmationModal } from './ui/confirmation-modal';
import { UpdateConfigModal } from './ui/update-config-modal';
import { UpdatePreviewModal } from './ui/update-preview-modal';
import { TrashManagementModal } from './ui/trash-modal';
import { scanLocalNotes, scanLocalPdfsByName } from './sync/matcher';
import { calculateSyncStatus, filterNewNotes, filterExistingNotes, splitByModificationStatus, deduplicateNotes } from './sync/status';
import { filterNotes, sortNotes } from './utils/filters';
import { NoteImporter } from './sync/importer';

interface WindowWithDebug {
    SUPERNOTE_DEBUG?: boolean;
}

export default class SupernoteCompanionPlugin extends Plugin {
    settings: SupernoteCompanionSettings;
    private apiClient: SupernoteAPIClient | null = null;

    async onload(): Promise<void> {
        await this.loadSettings();

        // Add settings tab
        this.addSettingTab(new SupernoteSettingTab(this.app, this));

        // Register commands
        this.registerCommands();

        console.debug('Supernote Companion plugin loaded');
    }

    onunload(): void {
        // Clean up API client reference
        this.apiClient = null;
        console.debug('Supernote Companion plugin unloaded');
    }

    async loadSettings(): Promise<void> {
        const data = await this.loadData() as SupernoteCompanionSettings | null;
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    /**
     * Get or create the API client for communicating with the Supernote device
     */
    getAPIClient(): SupernoteAPIClient {
        if (!this.apiClient) {
            // Use mock client for development if no device IP is configured
            if (!this.settings.deviceIp) {
                const useMock = (window as WindowWithDebug).SUPERNOTE_DEBUG ?? false;
                if (useMock) {
                    this.apiClient = new MockSupernoteAPIClient();
                } else {
                    throw new Error('Supernote device IP not configured. Please set it in the plugin settings.');
                }
            } else {
                this.apiClient = new SupernoteAPIClient(
                    this.settings.deviceIp,
                    this.settings.devicePort,
                    this.settings.connectionTimeout
                );
            }
        }
        return this.apiClient;
    }

    /**
     * Reset API client (call after settings change)
     */
    resetAPIClient(): void {
        this.apiClient = null;
    }

    /**
     * Create a NoteImporter with current settings
     */
    private createImporter(exportOptions?: ExportOptions): NoteImporter {
        const client = this.getAPIClient();
        return new NoteImporter(
            this.app.vault,
            client,
            this.settings.notesFolder,
            this.settings.pdfFolder,
            this.settings.importMode,
            this.settings.filenameTemplate,
            this.settings.preserveFolderStructure,
            exportOptions || this.getExportOptions(),
            this.settings.converterMode,
            this.settings.converterPath
        );
    }

    /**
     * Register all plugin commands
     */
    private registerCommands(): void {
        // Check Sync Status
        this.addCommand({
            id: 'check-sync-status',
            name: 'Check sync status',
            callback: () => { void this.checkSyncStatus(); }
        });

        // Import New Notes
        this.addCommand({
            id: 'import-new-notes',
            name: 'Import new notes',
            callback: () => { void this.importNewNotes(); }
        });

        // Update Existing Notes
        this.addCommand({
            id: 'update-existing-notes',
            name: 'Update existing notes',
            callback: () => { void this.updateExistingNotes(); }
        });

        // Bulk Export All
        this.addCommand({
            id: 'bulk-export-all',
            name: 'Bulk export all notes',
            callback: () => { void this.bulkExportAll(); }
        });

        // Manage Trashed Notes
        this.addCommand({
            id: 'manage-trashed-notes',
            name: 'Manage trashed notes',
            callback: () => { void this.manageTrash(); }
        });

        // Test Connection
        this.addCommand({
            id: 'test-connection',
            name: 'Test Supernote connection',
            callback: () => { void this.testConnection(); }
        });
    }

    /**
     * Test connection to Supernote device
     */
    private async testConnection(): Promise<void> {
        if (!this.settings.deviceIp) {
            new Notice('Please configure your Supernote device IP in settings first');
            return;
        }

        new Notice('Testing connection to Supernote device');

        try {
            const client = this.getAPIClient();
            const status = await client.checkConnection();

            if (status.connected) {
                new Notice(`Connected to Supernote at ${this.settings.deviceIp}:${this.settings.devicePort}`);
            } else {
                new Notice(`Failed to connect: ${status.error || 'Unknown error'}\n\nMake sure Browse & Access is enabled on your Supernote.`);
            }
        } catch (error) {
            new Notice(`Connection error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Check sync status command
     */
    private async checkSyncStatus(): Promise<void> {
        if (!this.settings.deviceIp) {
            new Notice('Please configure your Supernote device IP in settings first');
            return;
        }

        const client = this.getAPIClient();

        try {
            new Notice('Checking sync status');

            // Fetch remote notes
            const response = await client.fetchNoteFiles();
            let remoteNotes = deduplicateNotes(response.data);
            remoteNotes = filterNotes(remoteNotes, this.settings.trashedNoteIds);

            // Scan local notes (markdown with frontmatter)
            const localNotes = await scanLocalNotes(this.app.vault, this.settings.notesFolder);
            
            // Also scan for existing PDFs by name (for pdf-only mode)
            const existingPdfs = scanLocalPdfsByName(this.app.vault, this.settings.notesFolder);

            // Calculate status
            const status = calculateSyncStatus(remoteNotes, localNotes, existingPdfs);

            // Show status modal
            new SyncStatusModal(this.app, status).open();

        } catch (error) {
            console.error('Error checking sync status:', error);
            new Notice(`Failed to check sync status: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Import new notes command
     */
    private async importNewNotes(): Promise<void> {
        if (!this.settings.deviceIp) {
            new Notice('Please configure your Supernote device IP in settings first');
            return;
        }

        const client = this.getAPIClient();

        try {
            new Notice('Fetching new notes');

            // Fetch and filter remote notes
            const response = await client.fetchNoteFiles();
            let remoteNotes = deduplicateNotes(response.data);
            remoteNotes = filterNotes(remoteNotes, this.settings.trashedNoteIds);

            // Scan local notes (markdown with frontmatter)
            const localNotes = await scanLocalNotes(this.app.vault, this.settings.notesFolder);
            
            // Also scan for existing PDFs by name (for pdf-only mode)
            const existingPdfs = scanLocalPdfsByName(this.app.vault, this.settings.notesFolder);

            // Filter to only new notes (not in local markdown OR existing PDFs)
            const newNotes = filterNewNotes(remoteNotes, localNotes, existingPdfs);

            if (newNotes.length === 0) {
                new Notice('No new notes to import');
                return;
            }

            // Sort chronologically (oldest first)
            const sortedNotes = sortNotes(newNotes, 'date', true);

            // Show confirmation modal
            new ConfirmationModal(
                this.app,
                sortedNotes,
                'import',
                (selectedNotes) => {
                    void this.executeImport(selectedNotes);
                },
                () => {
                    new Notice('Import cancelled');
                },
                (noteId) => {
                    void this.trashNote(noteId);
                }
            ).open();

        } catch (error) {
            console.error('Error importing new notes:', error);
            new Notice(`Failed to fetch notes: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Execute the actual import
     */
    private async executeImport(notes: SupernoteFile[]): Promise<void> {
        if (notes.length === 0) {
            new Notice('No notes selected');
            return;
        }

        const progressNotice = new Notice('Starting import...', 0);

        try {
            const importer = this.createImporter();

            let finalFailureCount = 0;

            const successCount = await importer.importNotesWithProgress(
                notes,
                (current, total, success, failures, title) => {
                    finalFailureCount = failures;
                    progressNotice.setMessage(
                        `Importing: ${title}\nProgress: ${current}/${total} - ${success} success, ${failures} failed`
                    );
                }
            );

            // Update last sync timestamp
            this.settings.lastSync = Date.now();
            await this.saveSettings();

            // Update notice
            progressNotice.setMessage(`Successfully imported ${successCount} note(s)`);
            setTimeout(() => progressNotice.hide(), 3000);

            if (finalFailureCount > 0) {
                new Notice(`Failed to import ${finalFailureCount} note(s)`);
            }

        } catch (error) {
            progressNotice.hide();
            console.error('Error during import:', error);
            new Notice(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Update existing notes command
     */
    private async updateExistingNotes(): Promise<void> {
        if (!this.settings.deviceIp) {
            new Notice('Please configure your Supernote device IP in settings first');
            return;
        }

        const client = this.getAPIClient();

        try {
            new Notice('Fetching notes to update');

            // Fetch and filter remote notes
            const response = await client.fetchNoteFiles();
            let remoteNotes = deduplicateNotes(response.data);
            remoteNotes = filterNotes(remoteNotes, this.settings.trashedNoteIds);

            // Scan local notes
            const localNotes = await scanLocalNotes(this.app.vault, this.settings.notesFolder);

            // Filter to only existing notes
            const existingNotes = filterExistingNotes(remoteNotes, localNotes);

            if (existingNotes.length === 0) {
                new Notice('No notes to update');
                return;
            }

            // Split by modification status
            const { modified, unmodified } = splitByModificationStatus(
                existingNotes,
                localNotes,
                this.settings.lastSync
            );

            // Apply modification handling setting
            let notesToShow: SupernoteFile[];
            let skippedCount = 0;

            if (this.settings.updateModifiedFiles === 'skip') {
                notesToShow = unmodified;
                skippedCount = modified.length;

                if (notesToShow.length === 0) {
                    new Notice(`No notes to update (${skippedCount} modified file(s) skipped)`);
                    return;
                }

                if (skippedCount > 0) {
                    new Notice(`${skippedCount} modified file(s) will be skipped`);
                }
            } else {
                notesToShow = existingNotes;
            }

            // Show update config modal
            new UpdateConfigModal(
                this.app,
                this.settings.updateMode,
                this.settings.specificFrontmatterFields,
                this.settings.tagsMergeStrategy,
                this.settings.preserveCustomFields,
                this.getExportOptions(),
                (updateOptions) => {
                    void this.showUpdatePreview(notesToShow, localNotes, updateOptions);
                },
                () => {
                    new Notice('Update cancelled');
                }
            ).open();

        } catch (error) {
            console.error('Error updating notes:', error);
            new Notice(`Failed to fetch notes: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Show update preview and then confirmation
     */
    private async showUpdatePreview(
        notes: SupernoteFile[],
        localNotes: Map<string, LocalNoteFile>,
        updateOptions: UpdateOptions
    ): Promise<void> {
        const previewNotice = new Notice('Generating update preview...', 0);

        try {
            // Generate previews (simplified - in a real implementation you'd analyze actual changes)
            const previews: NoteUpdatePreview[] = [];

            for (let i = 0; i < notes.length; i++) {
                const note = notes[i];
                const localFile = localNotes.get(note.id);

                if (!localFile) continue;

                previewNotice.setMessage(`Analyzing ${i + 1}/${notes.length}: ${note.name}`);

                // Simplified preview - in production, you'd actually diff the files
                previews.push({
                    note,
                    localFile,
                    preview: {
                        hasChanges: true,
                        frontmatterChanges: [
                            { field: 'modified', oldValue: '', newValue: note.modifiedAt }
                        ],
                        contentChanged: updateOptions.mode === 'all' || updateOptions.mode === 'content-only',
                        customFieldsPreserved: updateOptions.preserveCustomFields ? ['custom_field'] : []
                    }
                });
            }

            previewNotice.hide();

            if (previews.length === 0) {
                new Notice('No changes detected');
                return;
            }

            // Show preview modal
            new UpdatePreviewModal(
                this.app,
                previews,
                updateOptions,
                () => {
                    // Show confirmation modal
                    const notesToUpdate = previews.map(p => p.note);

                    new ConfirmationModal(
                        this.app,
                        notesToUpdate,
                        'update',
                        (selectedNotes) => {
                            void this.executeUpdate(selectedNotes, localNotes, updateOptions);
                        },
                        () => {
                            new Notice('Update cancelled');
                        },
                        (noteId) => {
                            void this.trashNote(noteId);
                        },
                        this.settings.updateModifiedFiles === 'ask' ? this.settings.lastSync : undefined,
                        this.settings.updateModifiedFiles === 'ask' ? localNotes : undefined
                    ).open();
                },
                () => {
                    new Notice('Update cancelled');
                }
            ).open();

        } catch (error) {
            previewNotice.hide();
            console.error('Error generating preview:', error);
            new Notice(`Failed to generate preview: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Execute the actual update
     */
    private async executeUpdate(
        notes: SupernoteFile[],
        localNotes: Map<string, LocalNoteFile>,
        updateOptions: UpdateOptions
    ): Promise<void> {
        if (notes.length === 0) {
            new Notice('No notes selected');
            return;
        }

        const progressNotice = new Notice('Starting update...', 0);

        try {
            const importer = this.createImporter(updateOptions.exportOptions);
            importer.setUpdateOptions(updateOptions);

            // Build path map
            const pathMap = new Map<string, string>();
            notes.forEach(note => {
                const local = localNotes.get(note.id);
                if (local) {
                    pathMap.set(note.id, local.path);
                }
            });

            let finalFailureCount = 0;

            const successCount = await importer.updateNotesWithProgress(
                notes,
                pathMap,
                (current, total, success, failures, title) => {
                    finalFailureCount = failures;
                    progressNotice.setMessage(
                        `Updating: ${title}\nProgress: ${current}/${total} - ${success} success, ${failures} failed`
                    );
                }
            );

            // Update last sync timestamp
            this.settings.lastSync = Date.now();
            await this.saveSettings();

            // Update notice
            progressNotice.setMessage(`Successfully updated ${successCount} note(s)`);
            setTimeout(() => progressNotice.hide(), 3000);

            if (finalFailureCount > 0) {
                new Notice(`Failed to update ${finalFailureCount} note(s)`);
            }

        } catch (error) {
            progressNotice.hide();
            console.error('Error during update:', error);
            new Notice(`Update failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Bulk export all notes command
     */
    private async bulkExportAll(): Promise<void> {
        if (!this.settings.deviceIp) {
            new Notice('Please configure your Supernote device IP in settings first');
            return;
        }

        const client = this.getAPIClient();

        try {
            new Notice('Fetching all notes');

            // Fetch ALL notes (no filtering except trash)
            const response = await client.fetchNoteFiles();
            let allNotes = deduplicateNotes(response.data);
            allNotes = filterNotes(allNotes, this.settings.trashedNoteIds);

            if (allNotes.length === 0) {
                new Notice('No notes found');
                return;
            }

            // Sort chronologically
            const sortedNotes = sortNotes(allNotes, 'date', true);

            // Show confirmation modal
            new ConfirmationModal(
                this.app,
                sortedNotes,
                'export',
                (selectedNotes) => {
                    void this.executeImport(selectedNotes); // Same as import, but overwrites
                },
                () => {
                    new Notice('Export cancelled');
                },
                (noteId) => {
                    void this.trashNote(noteId);
                }
            ).open();

        } catch (error) {
            console.error('Error bulk exporting:', error);
            new Notice(`Failed to fetch notes: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Manage trashed notes command
     */
    private async manageTrash(): Promise<void> {
        try {
            // Try to fetch details for trashed notes
            let trashedNotes: SupernoteFile[] = [];

            if (this.settings.trashedNoteIds.length > 0 && this.settings.deviceIp) {
                try {
                    const client = this.getAPIClient();
                    const response = await client.fetchNoteFiles();
                    trashedNotes = response.data.filter(n => 
                        this.settings.trashedNoteIds.includes(n.id)
                    );
                } catch {
                    // If we can't fetch, just show IDs
                    trashedNotes = [];
                }
            }

            new TrashManagementModal(
                this.app,
                this.settings.trashedNoteIds,
                trashedNotes,
                (noteId) => {
                    void this.restoreNote(noteId);
                },
                () => {
                    void this.restoreAllNotes();
                }
            ).open();

        } catch (error) {
            console.error('Error managing trash:', error);
            new Notice(`Failed to open trash manager: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Add a note to trash (exclude from future syncs)
     */
    private async trashNote(noteId: string): Promise<void> {
        if (!this.settings.trashedNoteIds.includes(noteId)) {
            this.settings.trashedNoteIds.push(noteId);
            await this.saveSettings();
            new Notice('Note trashed');
        }
    }

    /**
     * Restore a note from trash
     */
    private async restoreNote(noteId: string): Promise<void> {
        this.settings.trashedNoteIds = this.settings.trashedNoteIds.filter(id => id !== noteId);
        await this.saveSettings();
    }

    /**
     * Restore all notes from trash
     */
    private async restoreAllNotes(): Promise<void> {
        this.settings.trashedNoteIds = [];
        await this.saveSettings();
    }

    /**
     * Get export options from settings
     */
    private getExportOptions(): ExportOptions {
        return {
            attachPdf: this.settings.attachPdf,
            includeThumbnail: this.settings.includeThumbnail,
        };
    }
}
