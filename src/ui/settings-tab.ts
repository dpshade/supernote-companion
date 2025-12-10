import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type SupernoteCompanionPlugin from '../main';
import { FrontmatterField } from '../api/types';
import { PdfConverter } from '../api/converter';

/**
 * Settings tab UI for the Supernote Companion plugin
 */
export class SupernoteSettingTab extends PluginSettingTab {
    plugin: SupernoteCompanionPlugin;

    constructor(app: App, plugin: SupernoteCompanionPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h1', { text: 'Supernote Companion Settings' });

        // Connection Settings
        this.createConnectionSettings(containerEl);

        // Sync Settings
        this.createSyncSettings(containerEl);

        // Update Behavior Settings
        this.createUpdateSettings(containerEl);

        // Export Options
        this.createExportSettings(containerEl);

        // Advanced Settings (collapsible)
        this.createAdvancedSettings(containerEl);
    }

    private createConnectionSettings(containerEl: HTMLElement): void {
        containerEl.createEl('h2', { text: 'Supernote Device Connection' });
        containerEl.createEl('p', {
            text: 'Connect to your Supernote device via WiFi. Enable "Browse & Access" on your Supernote to get the IP address.',
            cls: 'setting-item-description'
        });

        // Device IP
        new Setting(containerEl)
            .setName('Device IP address')
            .setDesc('The IP address shown when you enable Browse & Access on your Supernote (e.g., 192.168.1.100)')
            .addText(text => text
                .setPlaceholder('192.168.1.100')
                .setValue(this.plugin.settings.deviceIp)
                .onChange(async (value) => {
                    // Strip any URL prefix/suffix - user might paste full URL
                    let ip = value.trim();
                    // Remove http:// or https://
                    ip = ip.replace(/^https?:\/\//, '');
                    // Remove port suffix if present
                    ip = ip.replace(/:\d+\/?$/, '');
                    // Remove trailing slash
                    ip = ip.replace(/\/$/, '');
                    
                    this.plugin.settings.deviceIp = ip;
                    this.plugin.resetAPIClient();
                    await this.plugin.saveSettings();
                })
            );

        // Device Port
        new Setting(containerEl)
            .setName('Device port')
            .setDesc('The port for Browse & Access (default: 8089)')
            .addText(text => text
                .setPlaceholder('8089')
                .setValue(this.plugin.settings.devicePort.toString())
                .onChange(async (value) => {
                    const port = parseInt(value, 10);
                    if (!isNaN(port) && port > 0 && port <= 65535) {
                        this.plugin.settings.devicePort = port;
                        this.plugin.resetAPIClient();
                        await this.plugin.saveSettings();
                    }
                })
            );

        // Test Connection Button
        new Setting(containerEl)
            .setName('Test connection')
            .setDesc('Verify that the plugin can connect to your Supernote device')
            .addButton(button => button
                .setButtonText('Test Connection')
                .setCta()
                .onClick(async () => {
                    if (!this.plugin.settings.deviceIp) {
                        new Notice('Please enter your Supernote device IP address first.');
                        return;
                    }

                    button.setDisabled(true);
                    button.setButtonText('Testing...');
                    
                    try {
                        const client = this.plugin.getAPIClient();
                        const status = await client.checkConnection();
                        
                        if (status.connected) {
                            new Notice(`Connected to Supernote at ${this.plugin.settings.deviceIp}:${this.plugin.settings.devicePort}`);
                        } else {
                            new Notice(`Connection failed: ${status.error || 'Unknown error'}\n\nMake sure Browse & Access is enabled on your Supernote.`);
                        }
                    } catch (error) {
                        new Notice(`Connection error: ${error instanceof Error ? error.message : 'Unknown error'}`);
                    } finally {
                        button.setDisabled(false);
                        button.setButtonText('Test Connection');
                    }
                })
            );
    }

    private createSyncSettings(containerEl: HTMLElement): void {
        containerEl.createEl('h2', { text: 'Sync Configuration' });

        // Import Mode
        new Setting(containerEl)
            .setName('Import mode')
            .setDesc('How to import notes from your Supernote')
            .addDropdown(dropdown => dropdown
                .addOption('pdf-only', 'PDF only (recommended)')
                .addOption('markdown-with-pdf', 'Markdown + PDF attachment')
                .addOption('markdown-only', 'Markdown only (no PDF)')
                .setValue(this.plugin.settings.importMode)
                .onChange(async (value: 'pdf-only' | 'markdown-with-pdf' | 'markdown-only') => {
                    this.plugin.settings.importMode = value;
                    await this.plugin.saveSettings();
                    this.display(); // Refresh to show/hide PDF folder setting
                })
            );

        // Notes Folder
        new Setting(containerEl)
            .setName('Notes folder')
            .setDesc('Vault folder where imported files will be stored')
            .addText(text => text
                .setPlaceholder('/Supernote')
                .setValue(this.plugin.settings.notesFolder)
                .onChange(async (value) => {
                    this.plugin.settings.notesFolder = value;
                    await this.plugin.saveSettings();
                })
            );

        // PDF Folder (only shown for markdown-with-pdf mode)
        if (this.plugin.settings.importMode === 'markdown-with-pdf') {
            new Setting(containerEl)
                .setName('PDF folder')
                .setDesc('Vault folder where PDF attachments will be stored')
                .addText(text => text
                    .setPlaceholder('/Supernote/PDFs')
                    .setValue(this.plugin.settings.pdfFolder)
                    .onChange(async (value) => {
                        this.plugin.settings.pdfFolder = value;
                        await this.plugin.saveSettings();
                    })
                );
        }

        // Preserve Folder Structure
        new Setting(containerEl)
            .setName('Preserve folder structure')
            .setDesc('Mirror the folder structure from your Supernote (e.g., /Note/Work/Projects → Supernote/Work/Projects)')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.preserveFolderStructure)
                .onChange(async (value) => {
                    this.plugin.settings.preserveFolderStructure = value;
                    await this.plugin.saveSettings();
                })
            );

        // Filename Template
        new Setting(containerEl)
            .setName('Filename template')
            .setDesc('Template for imported filenames. Variables: {name}, {date}, {created}, {modified}, {datetime}, {year}, {month}, {day}, {pages}, {id}')
            .addText(text => text
                .setPlaceholder('{name}')
                .setValue(this.plugin.settings.filenameTemplate)
                .onChange(async (value) => {
                    this.plugin.settings.filenameTemplate = value || '{name}';
                    await this.plugin.saveSettings();
                })
            );

        // Template examples hint
        const templateHint = containerEl.createDiv('setting-item-description');
        templateHint.style.marginLeft = '20px';
        templateHint.style.marginBottom = '15px';
        templateHint.innerHTML = `
            <strong>Examples:</strong><br>
            <code>{name}</code> → "Meeting Notes"<br>
            <code>{date} {name}</code> → "2024-01-15 Meeting Notes"<br>
            <code>{year}/{month}/{name}</code> → "2024/01/Meeting Notes"
        `;

        // Last Sync Info
        if (this.plugin.settings.lastSync > 0) {
            const lastSyncDate = new Date(this.plugin.settings.lastSync);
            new Setting(containerEl)
                .setName('Last sync')
                .setDesc(`Last synced: ${lastSyncDate.toLocaleString()}`);
        }
    }

    private createUpdateSettings(containerEl: HTMLElement): void {
        containerEl.createEl('h2', { text: 'Update Behavior' });

        // Update Modified Files
        new Setting(containerEl)
            .setName('Update modified files')
            .setDesc('How to handle files that have been modified locally since last sync')
            .addDropdown(dropdown => dropdown
                .addOption('skip', 'Skip modified files (safest)')
                .addOption('ask', 'Ask me each time')
                .addOption('overwrite', 'Always overwrite (dangerous)')
                .setValue(this.plugin.settings.updateModifiedFiles)
                .onChange(async (value: 'skip' | 'overwrite' | 'ask') => {
                    this.plugin.settings.updateModifiedFiles = value;
                    await this.plugin.saveSettings();
                })
            );

        // Default Update Mode
        new Setting(containerEl)
            .setName('Default update mode')
            .setDesc('Choose what to update when syncing existing notes')
            .addDropdown(dropdown => dropdown
                .addOption('all', 'Update everything')
                .addOption('frontmatter-only', 'Update frontmatter only')
                .addOption('content-only', 'Update content only')
                .addOption('specific-frontmatter', 'Update specific frontmatter fields')
                .setValue(this.plugin.settings.updateMode)
                .onChange(async (value: any) => {
                    this.plugin.settings.updateMode = value;
                    await this.plugin.saveSettings();
                    // Refresh display to show/hide field selector
                    this.display();
                })
            );

        // Specific Fields Selector (conditional)
        if (this.plugin.settings.updateMode === 'specific-frontmatter') {
            this.createFieldSelector(containerEl);
        }

        // Preserve Custom Fields
        new Setting(containerEl)
            .setName('Preserve custom fields')
            .setDesc('Keep user-added frontmatter fields during updates')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.preserveCustomFields)
                .onChange(async (value) => {
                    this.plugin.settings.preserveCustomFields = value;
                    await this.plugin.saveSettings();
                })
            );

        // Tags Merge Strategy
        new Setting(containerEl)
            .setName('Tags merge strategy')
            .setDesc('How to handle tags when updating')
            .addDropdown(dropdown => dropdown
                .addOption('replace', 'Replace (overwrite all tags)')
                .addOption('merge', 'Merge (add new tags, keep existing)')
                .setValue(this.plugin.settings.tagsMergeStrategy)
                .onChange(async (value: 'replace' | 'merge') => {
                    this.plugin.settings.tagsMergeStrategy = value;
                    await this.plugin.saveSettings();
                })
            );
    }

    private createFieldSelector(containerEl: HTMLElement): void {
        const fieldsContainer = containerEl.createDiv('specific-fields-container');
        fieldsContainer.style.marginLeft = '20px';
        fieldsContainer.style.padding = '15px';
        fieldsContainer.style.backgroundColor = 'var(--background-secondary)';
        fieldsContainer.style.borderRadius = '8px';
        fieldsContainer.style.marginBottom = '15px';

        fieldsContainer.createEl('div', {
            text: 'Select which frontmatter fields to update:',
            cls: 'setting-item-description'
        }).style.marginBottom = '10px';

        const fieldOptions: Array<{ key: FrontmatterField; label: string; desc: string }> = [
            { key: 'name', label: 'Name', desc: 'Note title' },
            { key: 'source', label: 'Source', desc: 'Original path on Supernote' },
            { key: 'date', label: 'Date', desc: 'Creation and modification dates' },
            { key: 'pageCount', label: 'Page Count', desc: 'Number of pages' },
            { key: 'size', label: 'Size', desc: 'File size' },
            { key: 'tags', label: 'Tags', desc: 'Note tags' },
        ];

        fieldOptions.forEach(field => {
            new Setting(fieldsContainer)
                .setName(field.label)
                .setDesc(field.desc)
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.specificFrontmatterFields.includes(field.key))
                    .onChange(async (value) => {
                        if (value) {
                            if (!this.plugin.settings.specificFrontmatterFields.includes(field.key)) {
                                this.plugin.settings.specificFrontmatterFields.push(field.key);
                            }
                        } else {
                            this.plugin.settings.specificFrontmatterFields = 
                                this.plugin.settings.specificFrontmatterFields.filter(f => f !== field.key);
                        }
                        await this.plugin.saveSettings();
                    })
                );
        });
    }

    private createExportSettings(containerEl: HTMLElement): void {
        // Only show export options for markdown modes
        if (this.plugin.settings.importMode === 'pdf-only') {
            return;
        }

        containerEl.createEl('h2', { text: 'Markdown Options' });

        // Attach PDF (only for markdown-with-pdf mode)
        if (this.plugin.settings.importMode === 'markdown-with-pdf') {
            new Setting(containerEl)
                .setName('Attach PDF')
                .setDesc('Convert .note files to PDF and attach them to note entries')
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.attachPdf)
                    .onChange(async (value) => {
                        this.plugin.settings.attachPdf = value;
                        await this.plugin.saveSettings();
                    })
                );
        }

        // Include Thumbnail
        new Setting(containerEl)
            .setName('Include thumbnail')
            .setDesc('Embed a thumbnail preview image in the note (not available from device API)')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.includeThumbnail)
                .onChange(async (value) => {
                    this.plugin.settings.includeThumbnail = value;
                    await this.plugin.saveSettings();
                })
            );
    }

    private createAdvancedSettings(containerEl: HTMLElement): void {
        const advancedContainer = containerEl.createDiv('advanced-settings-container');
        advancedContainer.style.marginTop = '30px';
        advancedContainer.style.borderTop = '1px solid var(--background-modifier-border)';
        advancedContainer.style.paddingTop = '20px';

        // Collapsible header
        const advancedHeader = advancedContainer.createEl('h2', {
            text: '▶ Advanced Settings',
            cls: 'advanced-header'
        });
        advancedHeader.style.cursor = 'pointer';
        advancedHeader.style.userSelect = 'none';

        const advancedContent = advancedContainer.createDiv('advanced-content');
        advancedContent.style.display = 'none';
        advancedContent.style.marginTop = '15px';

        // Toggle collapse
        advancedHeader.addEventListener('click', () => {
            const isHidden = advancedContent.style.display === 'none';
            advancedContent.style.display = isHidden ? 'block' : 'none';
            advancedHeader.setText(isHidden ? '▼ Advanced Settings' : '▶ Advanced Settings');
        });

        // PDF Converter Section
        advancedContent.createEl('h3', { text: 'PDF Converter' });
        
        const converterDesc = advancedContent.createDiv('setting-item-description');
        converterDesc.style.marginBottom = '15px';
        converterDesc.innerHTML = `
            <strong>CLI (Recommended):</strong> Uses the supernote_pdf Rust binary for reliable conversion.<br>
            <strong>Built-in:</strong> Uses TypeScript implementation (experimental, may have rendering issues).
        `;

        // Converter Mode
        new Setting(advancedContent)
            .setName('Converter mode')
            .setDesc('Choose how to convert .note files to PDF')
            .addDropdown(dropdown => dropdown
                .addOption('cli', 'CLI binary (recommended)')
                .addOption('builtin', 'Built-in TypeScript (experimental)')
                .setValue(this.plugin.settings.converterMode)
                .onChange(async (value: 'cli' | 'builtin') => {
                    this.plugin.settings.converterMode = value;
                    await this.plugin.saveSettings();
                    this.display(); // Refresh to show/hide CLI path setting
                })
            );

        // CLI Path (only shown for CLI mode)
        if (this.plugin.settings.converterMode === 'cli') {
            new Setting(advancedContent)
                .setName('CLI binary path')
                .setDesc('Path to the supernote_pdf binary (e.g., /usr/local/bin/supernote_pdf)')
                .addText(text => text
                    .setPlaceholder('/path/to/supernote_pdf')
                    .setValue(this.plugin.settings.converterPath)
                    .onChange(async (value) => {
                        this.plugin.settings.converterPath = value.trim();
                        await this.plugin.saveSettings();
                    })
                );

            // Test CLI Button
            new Setting(advancedContent)
                .setName('Test converter')
                .setDesc('Verify that the CLI binary is accessible')
                .addButton(button => button
                    .setButtonText('Test CLI')
                    .onClick(async () => {
                        if (!this.plugin.settings.converterPath) {
                            new Notice('Please set the CLI binary path first.');
                            return;
                        }
                        
                        button.setDisabled(true);
                        button.setButtonText('Testing...');
                        
                        try {
                            const converter = new PdfConverter(
                                this.plugin.settings.converterMode,
                                this.plugin.settings.converterPath
                            );
                            const available = await converter.isToolAvailable();
                            const version = await converter.getToolVersion();
                            
                            if (available) {
                                new Notice(`CLI converter working! ${version}`);
                            } else {
                                new Notice('CLI binary not found or not executable. Check the path.');
                            }
                        } catch (error) {
                            new Notice(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
                        } finally {
                            button.setDisabled(false);
                            button.setButtonText('Test CLI');
                        }
                    })
                );
        } else {
            // Built-in converter info
            new Setting(advancedContent)
                .setName('Converter status')
                .setDesc('Built-in TypeScript converter (experimental)')
                .addButton(button => button
                    .setButtonText('Check Version')
                    .onClick(async () => {
                        const converter = new PdfConverter('builtin', '');
                        const version = await converter.getToolVersion();
                        new Notice(`PDF Converter: ${version}`);
                    })
                );
        }

        // Connection Timeout
        new Setting(advancedContent)
            .setName('Connection timeout')
            .setDesc('Timeout for device connections in milliseconds')
            .addText(text => text
                .setPlaceholder('10000')
                .setValue(this.plugin.settings.connectionTimeout.toString())
                .onChange(async (value) => {
                    const timeout = parseInt(value, 10);
                    if (!isNaN(timeout) && timeout > 0) {
                        this.plugin.settings.connectionTimeout = timeout;
                        await this.plugin.saveSettings();
                    }
                })
            );

        // Clear Trash
        new Setting(advancedContent)
            .setName('Clear trashed notes')
            .setDesc(`${this.plugin.settings.trashedNoteIds.length} note(s) currently in trash`)
            .addButton(button => button
                .setButtonText('Clear Trash')
                .setWarning()
                .onClick(async () => {
                    this.plugin.settings.trashedNoteIds = [];
                    await this.plugin.saveSettings();
                    new Notice('Trash cleared. All notes will appear in future syncs.');
                    this.display(); // Refresh to update count
                })
            );

        // Reset Last Sync
        new Setting(advancedContent)
            .setName('Reset sync timestamp')
            .setDesc('Reset the last sync time (useful for forcing a full resync)')
            .addButton(button => button
                .setButtonText('Reset')
                .setWarning()
                .onClick(async () => {
                    this.plugin.settings.lastSync = 0;
                    await this.plugin.saveSettings();
                    new Notice('Sync timestamp reset. All notes will be treated as updated.');
                    this.display();
                })
            );

        // Debug Mode Toggle (for development)
        new Setting(advancedContent)
            .setName('Debug mode')
            .setDesc('Enable verbose logging and mock client for testing without a real device')
            .addToggle(toggle => toggle
                .setValue((window as any).SUPERNOTE_DEBUG || false)
                .onChange((value) => {
                    (window as any).SUPERNOTE_DEBUG = value;
                    this.plugin.resetAPIClient();
                    new Notice(`Debug mode ${value ? 'enabled' : 'disabled'}`);
                })
            );
    }
}
