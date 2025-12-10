import { App, Modal, Setting } from 'obsidian';
import { UpdateMode, FrontmatterField, UpdateOptions, ExportOptions, MergeStrategy } from '../api/types';

/**
 * Modal for configuring update options before applying updates
 */
export class UpdateConfigModal extends Modal {
    private updateMode: UpdateMode;
    private specificFields: Set<FrontmatterField>;
    private tagsMergeStrategy: MergeStrategy;
    private preserveCustomFields: boolean;
    private exportOptions: ExportOptions;
    
    private onConfirm: (options: UpdateOptions) => void;
    private onCancel: () => void;
    
    private fieldsContainer: HTMLElement | null = null;

    constructor(
        app: App,
        defaultMode: UpdateMode,
        defaultFields: FrontmatterField[],
        defaultTagsStrategy: MergeStrategy,
        defaultPreserveCustomFields: boolean,
        exportOptions: ExportOptions,
        onConfirm: (options: UpdateOptions) => void,
        onCancel: () => void
    ) {
        super(app);
        this.updateMode = defaultMode;
        this.specificFields = new Set(defaultFields);
        this.tagsMergeStrategy = defaultTagsStrategy;
        this.preserveCustomFields = defaultPreserveCustomFields;
        this.exportOptions = exportOptions;
        this.onConfirm = onConfirm;
        this.onCancel = onCancel;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();

        // Modal styling
        this.modalEl.style.width = '550px';
        this.modalEl.style.maxWidth = '90%';
        this.titleEl.setText('Configure Update Options');

        // Description
        contentEl.createEl('p', {
            text: 'Choose what to update in the selected notes. These settings override your defaults for this update only.',
            cls: 'setting-item-description'
        }).style.marginBottom = '20px';

        // Update Mode
        new Setting(contentEl)
            .setName('Update mode')
            .setDesc('Choose what to update')
            .addDropdown(dropdown => dropdown
                .addOption('all', 'Update everything')
                .addOption('frontmatter-only', 'Update frontmatter only')
                .addOption('content-only', 'Update content only')
                .addOption('specific-frontmatter', 'Update specific frontmatter fields')
                .setValue(this.updateMode)
                .onChange((value: UpdateMode) => {
                    this.updateMode = value;
                    this.refreshFieldsSection();
                })
            );

        // Fields container (conditionally shown)
        this.fieldsContainer = contentEl.createDiv('update-specific-fields');
        this.refreshFieldsSection();

        // Preserve custom fields toggle
        new Setting(contentEl)
            .setName('Preserve custom fields')
            .setDesc('Keep user-added frontmatter fields that are not part of standard Supernote data')
            .addToggle(toggle => toggle
                .setValue(this.preserveCustomFields)
                .onChange((value) => {
                    this.preserveCustomFields = value;
                })
            );

        // Array merge strategy section
        contentEl.createEl('h4', { text: 'Array Merge Strategies' }).style.marginTop = '20px';

        new Setting(contentEl)
            .setName('Tags')
            .setDesc('How to handle tags when updating')
            .addDropdown(dropdown => dropdown
                .addOption('replace', 'Replace (overwrite all)')
                .addOption('merge', 'Merge (combine existing + new)')
                .setValue(this.tagsMergeStrategy)
                .onChange((value: MergeStrategy) => {
                    this.tagsMergeStrategy = value;
                })
            );

        // Buttons
        const buttonContainer = contentEl.createDiv({ cls: 'modal-button-container' });
        buttonContainer.style.marginTop = '25px';
        buttonContainer.style.display = 'flex';
        buttonContainer.style.gap = '10px';
        buttonContainer.style.justifyContent = 'flex-end';

        const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelButton.onclick = () => {
            this.close();
            this.onCancel();
        };

        const continueButton = buttonContainer.createEl('button', {
            text: 'Continue',
            cls: 'mod-cta'
        });
        continueButton.onclick = () => {
            const options: UpdateOptions = {
                mode: this.updateMode,
                specificFields: this.updateMode === 'specific-frontmatter' 
                    ? Array.from(this.specificFields) 
                    : undefined,
                preserveCustomFields: this.preserveCustomFields,
                arrayMergeStrategy: {
                    tags: this.tagsMergeStrategy,
                },
                exportOptions: this.exportOptions,
            };
            this.close();
            this.onConfirm(options);
        };
    }

    private refreshFieldsSection(): void {
        if (!this.fieldsContainer) return;

        this.fieldsContainer.empty();

        if (this.updateMode === 'specific-frontmatter') {
            this.fieldsContainer.style.display = 'block';
            this.fieldsContainer.style.marginLeft = '20px';
            this.fieldsContainer.style.padding = '15px';
            this.fieldsContainer.style.backgroundColor = 'var(--background-secondary)';
            this.fieldsContainer.style.borderRadius = '8px';
            this.fieldsContainer.style.marginBottom = '15px';

            this.fieldsContainer.createEl('div', {
                text: 'Select which frontmatter fields to update:',
                cls: 'setting-item-description'
            }).style.marginBottom = '10px';

            const fieldOptions: Array<{ key: FrontmatterField; label: string; desc: string }> = [
                { key: 'name', label: 'Name', desc: 'Note title' },
                { key: 'source', label: 'Source', desc: 'Original Supernote path' },
                { key: 'date', label: 'Date', desc: 'Creation/modification dates' },
                { key: 'pageCount', label: 'Page Count', desc: 'Number of pages' },
                { key: 'size', label: 'Size', desc: 'File size' },
                { key: 'tags', label: 'Tags', desc: 'Note tags' },
            ];

            fieldOptions.forEach(field => {
                new Setting(this.fieldsContainer!)
                    .setName(field.label)
                    .setDesc(field.desc)
                    .addToggle(toggle => toggle
                        .setValue(this.specificFields.has(field.key))
                        .onChange((value) => {
                            if (value) {
                                this.specificFields.add(field.key);
                            } else {
                                this.specificFields.delete(field.key);
                            }
                        })
                    );
            });
        } else {
            this.fieldsContainer.style.display = 'none';
        }
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
