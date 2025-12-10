import { Vault, TFolder, TFile, normalizePath } from 'obsidian';
import { SupernoteAPIClient } from '../api/client';
import { PdfConverter } from '../api/converter';
import { SupernoteFile, ExportOptions, UpdateOptions } from '../api/types';
import { ImportMode, ConverterMode } from '../settings';
import { generateMarkdown, generateFilename, generatePdfFilename, updateFrontmatter } from '../utils/markdown';
import { parseFrontmatter } from './matcher';
import * as fs from 'fs';
import * as path from 'path';

// Concurrency limit for parallel downloads
const MAX_CONCURRENT_DOWNLOADS = 6;

/**
 * Run async functions with a concurrency limit
 */
async function parallelLimit<T, R>(
    items: T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    const results: R[] = new Array(items.length) as R[];
    let currentIndex = 0;

    async function worker(): Promise<void> {
        while (currentIndex < items.length) {
            const index = currentIndex++;
            results[index] = await fn(items[index], index);
        }
    }

    // Start `limit` workers
    const workers = Array(Math.min(limit, items.length))
        .fill(null)
        .map(() => worker());

    await Promise.all(workers);
    return results;
}

/**
 * Progress callback type for tracking import progress
 */
export type ProgressCallback = (
    current: number,
    total: number,
    successCount: number,
    failureCount: number,
    currentTitle: string
) => void;

/**
 * Result of an import/update operation
 */
export interface ImportResult {
    success: boolean;
    note: SupernoteFile;
    markdownPath?: string;
    pdfPath?: string;
    error?: string;
}

/**
 * NoteImporter handles importing and updating Supernote files in the vault.
 *
 * Supports three import modes:
 * - pdf-only: Just imports the PDF files (simplest, cleanest)
 * - markdown-with-pdf: Creates markdown files with PDF attachments
 * - markdown-only: Creates markdown files without PDF conversion
 */
export class NoteImporter {
    private vault: Vault;
    private client: SupernoteAPIClient;
    private pdfConverter: PdfConverter;
    private notesFolder: string;
    private pdfFolder: string;
    private importMode: ImportMode;
    private filenameTemplate: string;
    private preserveFolderStructure: boolean;
    private exportOptions: ExportOptions;
    private updateOptions?: UpdateOptions;

    constructor(
        vault: Vault,
        client: SupernoteAPIClient,
        notesFolder: string,
        pdfFolder: string,
        importMode: ImportMode,
        filenameTemplate: string,
        preserveFolderStructure: boolean,
        exportOptions: ExportOptions,
        converterMode: ConverterMode = 'cli',
        converterPath: string = ''
    ) {
        this.vault = vault;
        this.client = client;
        this.pdfConverter = new PdfConverter(converterMode, converterPath);
        this.notesFolder = notesFolder;
        this.pdfFolder = pdfFolder;
        this.importMode = importMode;
        this.filenameTemplate = filenameTemplate;
        this.preserveFolderStructure = preserveFolderStructure;
        this.exportOptions = exportOptions;
    }

    /**
     * Check if the PDF conversion is available (always true with built-in converter)
     */
    isPdfToolAvailable(): boolean {
        return this.pdfConverter.isToolAvailable();
    }

    /**
     * Get the version of the PDF converter
     */
    async getPdfToolVersion(): Promise<string> {
        return this.pdfConverter.getToolVersion();
    }

    /**
     * Set update options for selective updates
     */
    setUpdateOptions(options: UpdateOptions): void {
        this.updateOptions = options;
    }

    /**
     * Import multiple notes with progress tracking.
     * Uses batch mode for pdf-only imports with CLI converter (much faster).
     * Falls back to single-file mode for other import modes or built-in converter.
     */
    async importNotesWithProgress(
        notes: SupernoteFile[],
        onProgress: ProgressCallback
    ): Promise<number> {
        // Use batch mode for pdf-only with CLI converter
        if (this.importMode === 'pdf-only' && this.pdfConverter.canBatchConvert()) {
            return this.importNotesWithProgressBatch(notes, onProgress);
        }

        // Fall back to single-file mode
        return this.importNotesWithProgressSingle(notes, onProgress);
    }

    /**
     * Import notes one at a time (legacy mode, used for markdown modes or built-in converter)
     */
    private async importNotesWithProgressSingle(
        notes: SupernoteFile[],
        onProgress: ProgressCallback
    ): Promise<number> {
        let successCount = 0;
        let failureCount = 0;
        const total = notes.length;

        for (let i = 0; i < notes.length; i++) {
            const note = notes[i];
            onProgress(i + 1, total, successCount, failureCount, note.name);

            try {
                await this.importSingleNote(note);
                successCount++;
            } catch (error) {
                console.error(`Failed to import ${note.name}:`, error);
                failureCount++;
            }
        }

        return successCount;
    }

    /**
     * Import notes using batch mode (CLI only, pdf-only mode).
     *
     * Flow:
     * 1. Download all .note files in parallel to a temp directory
     * 2. Run CLI converter once on the entire directory
     * 3. Copy all PDFs to the vault
     * 4. Clean up temp directories
     */
    private async importNotesWithProgressBatch(
        notes: SupernoteFile[],
        onProgress: ProgressCallback
    ): Promise<number> {
        const total = notes.length;
        let successCount = 0;
        let failureCount = 0;

        if (total === 0) return 0;

        console.debug(`[importer] Starting batch import of ${total} notes (${MAX_CONCURRENT_DOWNLOADS} concurrent downloads)`);

        // Create temp directories
        // Input dir needs to exist for us to write .note files
        // Output dir should NOT exist - the CLI will create it
        const inputTempDir = this.pdfConverter.createTempDir('supernote_batch_input', true);
        const outputTempDir = this.pdfConverter.createTempDir('supernote_batch_output', false);

        try {
            // Phase 1: Download all .note files in parallel
            onProgress(0, total, 0, 0, `Downloading ${total} notes...`);
            console.debug(`[importer] Phase 1: Downloading ${total} notes in parallel to ${inputTempDir}`);

            const downloadStartTime = Date.now();
            let downloadedCount = 0;

            type DownloadResult = { note: SupernoteFile; relativePath: string } | { note: SupernoteFile; error: string };

            const downloadResults = await parallelLimit(notes, MAX_CONCURRENT_DOWNLOADS, async (note, _index) => {
                try {
                    // Download the .note file
                    const noteData = await this.client.downloadNoteFile(note.path);

                    // Compute relative path (preserving folder structure)
                    const relativePath = this.getRelativeNotePath(note);

                    // Write to temp directory
                    await this.pdfConverter.writeNoteToTempDir(inputTempDir, relativePath, noteData);

                    downloadedCount++;
                    onProgress(downloadedCount, total, 0, 0, `Downloaded ${downloadedCount}/${total}: ${note.name}`);
                    console.debug(`[importer] Downloaded (${downloadedCount}/${total}): ${relativePath}`);

                    return { note, relativePath } as DownloadResult;
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    console.error(`[importer] Failed to download ${note.name}:`, error);
                    return { note, error: errorMsg } as DownloadResult;
                }
            });

            const downloadTimeMs = Date.now() - downloadStartTime;

            // Separate successful downloads from failures
            const downloadedNotes: Array<{ note: SupernoteFile; relativePath: string }> = [];
            for (const result of downloadResults) {
                if ('relativePath' in result) {
                    downloadedNotes.push(result);
                } else {
                    failureCount++;
                }
            }

            console.debug(`[importer] Downloaded ${downloadedNotes.length}/${total} notes in ${downloadTimeMs}ms (${Math.round(downloadTimeMs / total)}ms avg per file)`);

            if (downloadedNotes.length === 0) {
                console.error('[importer] No notes downloaded successfully');
                return 0;
            }

            // Phase 2: Convert all notes at once
            onProgress(downloadedNotes.length, total, 0, failureCount, 'Converting to PDF...');
            console.debug(`[importer] Phase 2: Converting ${downloadedNotes.length} notes`);

            const conversionResult = await this.pdfConverter.convertDirectory(inputTempDir, outputTempDir);

            if (!conversionResult.success) {
                console.error(`[importer] Batch conversion failed: ${conversionResult.error}`);
                // Fall back to single-file mode
                console.debug('[importer] Falling back to single-file mode');
                return this.importNotesWithProgressSingle(notes, onProgress);
            }

            console.debug(`[importer] Conversion complete: ${conversionResult.fileCount} PDFs in ${conversionResult.conversionTimeMs}ms`);

            // Phase 3: Copy PDFs to vault
            onProgress(downloadedNotes.length, total, 0, failureCount, 'Importing to vault...');
            console.debug(`[importer] Phase 3: Copying PDFs to vault`);

            for (let i = 0; i < downloadedNotes.length; i++) {
                const { note, relativePath } = downloadedNotes[i];
                onProgress(i + 1, total, successCount, failureCount, `Importing: ${note.name}`);

                try {
                    // Find the corresponding PDF
                    const pdfRelativePath = relativePath.replace(/\.note$/, '.pdf');
                    const pdfTempPath = path.join(outputTempDir, pdfRelativePath);

                    // Check if PDF was created
                    if (!fs.existsSync(pdfTempPath)) {
                        console.error(`[importer] PDF not found: ${pdfTempPath}`);
                        failureCount++;
                        continue;
                    }

                    // Read PDF data
                    const pdfBuffer = await fs.promises.readFile(pdfTempPath);
                    const pdfData = pdfBuffer.buffer.slice(
                        pdfBuffer.byteOffset,
                        pdfBuffer.byteOffset + pdfBuffer.byteLength
                    );

                    // Generate vault path
                    const pdfFilename = generatePdfFilename(note, this.filenameTemplate);
                    const pdfVaultPath = this.buildVaultPath(this.notesFolder, note, pdfFilename);

                    // Ensure folder exists
                    const folderPath = pdfVaultPath.substring(0, pdfVaultPath.lastIndexOf('/'));
                    if (folderPath) {
                        await this.ensureFolderExists(folderPath);
                    }

                    // Write to vault
                    const existingPdf = this.vault.getAbstractFileByPath(pdfVaultPath);
                    if (existingPdf instanceof TFile) {
                        await this.vault.modifyBinary(existingPdf, pdfData);
                    } else {
                        await this.vault.createBinary(pdfVaultPath, pdfData);
                    }

                    console.debug(`[importer] Imported: ${pdfVaultPath}`);
                    successCount++;
                } catch (error) {
                    console.error(`[importer] Failed to import ${note.name} to vault:`, error);
                    failureCount++;
                }
            }

            console.debug(`[importer] Batch import complete: ${successCount} succeeded, ${failureCount} failed`);
            return successCount;

        } finally {
            // Phase 4: Cleanup temp directories
            console.debug('[importer] Phase 4: Cleaning up temp directories');
            await this.pdfConverter.cleanupTempDir(inputTempDir);
            await this.pdfConverter.cleanupTempDir(outputTempDir);
        }
    }

    /**
     * Get the relative path for a note file (e.g., "Work/Projects/meeting.note")
     */
    private getRelativeNotePath(note: SupernoteFile): string {
        // Remove leading /Note/ prefix
        const withoutNotePrefix = note.path.replace(/^\/Note\/?/, '');

        // If preserving folder structure, use the full relative path
        if (this.preserveFolderStructure) {
            return withoutNotePrefix;
        }

        // Otherwise just use the filename
        const lastSlash = withoutNotePrefix.lastIndexOf('/');
        return lastSlash >= 0 ? withoutNotePrefix.substring(lastSlash + 1) : withoutNotePrefix;
    }

    /**
     * Import a single note based on import mode
     */
    async importSingleNote(note: SupernoteFile): Promise<ImportResult> {
        switch (this.importMode) {
            case 'pdf-only':
                return this.importPdfOnly(note);
            case 'markdown-with-pdf':
                return this.importMarkdownWithPdf(note);
            case 'markdown-only':
                return this.importMarkdownOnly(note);
            default:
                return this.importPdfOnly(note);
        }
    }

    /**
     * Get the relative folder path from a Supernote note path.
     * E.g., "/Note/Work/Projects/meeting.note" -> "Work/Projects"
     * E.g., "/Note/signature.note" -> "" (empty - file is in root)
     */
    private getRelativeFolderPath(notePath: string): string {
        // Remove leading /Note/ or /Note prefix
        const withoutNotePrefix = notePath.replace(/^\/Note\/?/, '');

        // Find the last slash to separate directory from filename
        const lastSlashIndex = withoutNotePrefix.lastIndexOf('/');

        // If no slash found, file is in root - return empty string
        if (lastSlashIndex === -1) {
            return '';
        }

        // Return everything before the last slash (the directory path)
        return withoutNotePrefix.substring(0, lastSlashIndex);
    }

    /**
     * Build the full vault path for a file, optionally preserving folder structure
     */
    private buildVaultPath(baseFolder: string, note: SupernoteFile, filename: string): string {
        const normalizedBase = baseFolder.startsWith('/')
            ? baseFolder.slice(1)
            : baseFolder;

        if (this.preserveFolderStructure) {
            const relativePath = this.getRelativeFolderPath(note.path);
            if (relativePath) {
                return normalizePath(`${normalizedBase}/${relativePath}/${filename}`);
            }
        }

        return normalizePath(`${normalizedBase}/${filename}`);
    }

    /**
     * Import just the PDF file (simplest mode)
     */
    private async importPdfOnly(note: SupernoteFile): Promise<ImportResult> {
        try {
            // Download and convert to PDF
            const noteData = await this.client.downloadNoteFile(note.path);
            const conversionResult = await this.pdfConverter.convert(noteData, note.id);

            if (!conversionResult.success || !conversionResult.pdfData) {
                throw new Error(`PDF conversion failed: ${conversionResult.error ?? 'Unknown error'}`);
            }

            // Generate PDF filename and full vault path
            const pdfFilename = generatePdfFilename(note, this.filenameTemplate);
            const pdfVaultPath = this.buildVaultPath(this.notesFolder, note, pdfFilename);

            // Ensure folder exists (including any subfolders)
            const folderPath = pdfVaultPath.substring(0, pdfVaultPath.lastIndexOf('/'));
            if (folderPath) {
                await this.ensureFolderExists(folderPath);
            }

            // Write PDF to vault
            const existingPdf = this.vault.getAbstractFileByPath(pdfVaultPath);
            if (existingPdf instanceof TFile) {
                await this.vault.modifyBinary(existingPdf, conversionResult.pdfData);
            } else {
                await this.vault.createBinary(pdfVaultPath, conversionResult.pdfData);
            }

            console.debug(`Imported ${note.name} as PDF (${conversionResult.pageCount} pages) in ${conversionResult.conversionTimeMs}ms`);

            return {
                success: true,
                note,
                pdfPath: pdfVaultPath,
            };
        } catch (error) {
            return {
                success: false,
                note,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Import markdown file with PDF attachment (original mode)
     */
    private async importMarkdownWithPdf(note: SupernoteFile): Promise<ImportResult> {
        try {
            let pdfVaultPath: string | undefined;
            let thumbnailBase64: string | undefined;

            // Handle PDF attachment
            if (this.exportOptions.attachPdf) {
                pdfVaultPath = await this.handlePdfAttachment(note);
            }

            // Get thumbnail if enabled
            if (this.exportOptions.includeThumbnail) {
                thumbnailBase64 = this.client.getThumbnail(note.id) ?? undefined;
            }

            // Generate markdown content
            const content = generateMarkdown(note, this.exportOptions, pdfVaultPath, thumbnailBase64);

            // Generate filename and full vault path
            const filename = generateFilename(note, this.filenameTemplate);
            const filepath = this.buildVaultPath(this.notesFolder, note, filename);

            // Ensure folder exists
            const folderPath = filepath.substring(0, filepath.lastIndexOf('/'));
            if (folderPath) {
                await this.ensureFolderExists(folderPath);
            }

            // Write file
            const existingFile = this.vault.getAbstractFileByPath(filepath);
            if (existingFile instanceof TFile) {
                await this.vault.modify(existingFile, content);
            } else {
                await this.vault.create(filepath, content);
            }

            return {
                success: true,
                note,
                markdownPath: filepath,
                pdfPath: pdfVaultPath,
            };
        } catch (error) {
            return {
                success: false,
                note,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Import just the markdown file without PDF
     */
    private async importMarkdownOnly(note: SupernoteFile): Promise<ImportResult> {
        try {
            let thumbnailBase64: string | undefined;

            // Get thumbnail if enabled
            if (this.exportOptions.includeThumbnail) {
                thumbnailBase64 = this.client.getThumbnail(note.id) ?? undefined;
            }

            // Generate markdown content (no PDF path)
            const optionsWithoutPdf = { ...this.exportOptions, attachPdf: false };
            const content = generateMarkdown(note, optionsWithoutPdf, undefined, thumbnailBase64);

            // Generate filename and full vault path
            const filename = generateFilename(note, this.filenameTemplate);
            const filepath = this.buildVaultPath(this.notesFolder, note, filename);

            // Ensure folder exists
            const folderPath = filepath.substring(0, filepath.lastIndexOf('/'));
            if (folderPath) {
                await this.ensureFolderExists(folderPath);
            }

            // Write file
            const existingFile = this.vault.getAbstractFileByPath(filepath);
            if (existingFile instanceof TFile) {
                await this.vault.modify(existingFile, content);
            } else {
                await this.vault.create(filepath, content);
            }

            return {
                success: true,
                note,
                markdownPath: filepath,
            };
        } catch (error) {
            return {
                success: false,
                note,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Update multiple notes with progress tracking
     */
    async updateNotesWithProgress(
        notes: SupernoteFile[],
        localPaths: Map<string, string>, // noteId -> vault path
        onProgress: ProgressCallback
    ): Promise<number> {
        let successCount = 0;
        let failureCount = 0;
        const total = notes.length;

        for (let i = 0; i < notes.length; i++) {
            const note = notes[i];
            const localPath = localPaths.get(note.id);

            onProgress(i + 1, total, successCount, failureCount, note.name);

            if (!localPath) {
                console.warn(`No local path found for note ${note.id}, skipping update`);
                failureCount++;
                continue;
            }

            try {
                await this.updateSingleNote(note, localPath);
                successCount++;
            } catch (error) {
                console.error(`Failed to update ${note.name}:`, error);
                failureCount++;
            }
        }

        return successCount;
    }

    /**
     * Update a single note with selective update support
     */
    async updateSingleNote(note: SupernoteFile, existingPath: string): Promise<ImportResult> {
        // For PDF-only mode, just re-import the PDF
        if (this.importMode === 'pdf-only') {
            return this.importPdfOnly(note);
        }

        try {
            const file = this.vault.getAbstractFileByPath(existingPath);
            if (!(file instanceof TFile)) {
                throw new Error(`File not found: ${existingPath}`);
            }

            const existingContent = await this.vault.read(file);
            const existingFrontmatter = parseFrontmatter(existingContent);

            let newContent: string;
            let pdfVaultPath = existingFrontmatter.pdf_attachment as string | undefined;

            // Handle PDF update if needed
            if (this.exportOptions.attachPdf && this.importMode === 'markdown-with-pdf') {
                if (!pdfVaultPath || this.shouldUpdatePdf()) {
                    pdfVaultPath = await this.handlePdfAttachment(note);
                }
            }

            // Get thumbnail if needed
            let thumbnailBase64: string | undefined;
            if (this.exportOptions.includeThumbnail) {
                thumbnailBase64 = this.client.getThumbnail(note.id) ?? undefined;
            }

            // Apply update based on mode
            if (this.updateOptions) {
                newContent = this.applySelectiveUpdate(
                    existingContent,
                    note,
                    pdfVaultPath,
                    thumbnailBase64
                );
            } else {
                // Full update - regenerate everything
                newContent = generateMarkdown(note, this.exportOptions, pdfVaultPath, thumbnailBase64);
            }

            // Write updated content
            await this.vault.modify(file, newContent);

            return {
                success: true,
                note,
                markdownPath: existingPath,
                pdfPath: pdfVaultPath,
            };
        } catch (error) {
            return {
                success: false,
                note,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Apply selective update based on update options
     */
    private applySelectiveUpdate(
        existingContent: string,
        note: SupernoteFile,
        pdfVaultPath?: string,
        _thumbnailBase64?: string
    ): string {
        if (!this.updateOptions) {
            return existingContent;
        }

        const { mode, specificFields, preserveCustomFields } = this.updateOptions;

        // Build new frontmatter values
        const newFrontmatter: Record<string, unknown> = {
            name: note.name,
            supernote_id: note.id,
            source: note.path,
            created: new Date(note.createdAt).toISOString().split('T')[0],
            modified: new Date(note.modifiedAt).toISOString().split('T')[0],
            pages: note.pageCount,
            size: `${Math.round(note.size / 1024)} KB`,
        };

        if (pdfVaultPath) {
            newFrontmatter.pdf_attachment = pdfVaultPath;
        }

        switch (mode) {
            case 'frontmatter-only':
                // Update all frontmatter fields, keep body
                return updateFrontmatter(existingContent, newFrontmatter, preserveCustomFields);

            case 'content-only':
                // Keep frontmatter, update body
                // For now, we don't regenerate body separately
                return existingContent;

            case 'specific-frontmatter':
                // Update only specified fields
                return updateFrontmatter(existingContent, newFrontmatter, preserveCustomFields, specificFields);

            case 'all':
            default:
                // Full update
                return generateMarkdown(
                    note,
                    this.updateOptions.exportOptions,
                    pdfVaultPath
                );
        }
    }

    /**
     * Handle PDF attachment - download .note file and convert to PDF locally
     */
    private async handlePdfAttachment(note: SupernoteFile): Promise<string> {
        // Step 1: Download the .note file from the Supernote device
        const noteData = await this.client.downloadNoteFile(note.path);

        // Step 2: Convert to PDF using built-in converter
        const conversionResult = await this.pdfConverter.convert(noteData, note.id);

        if (!conversionResult.success || !conversionResult.pdfData) {
            throw new Error(`PDF conversion failed: ${conversionResult.error ?? 'Unknown error'}`);
        }

        // Step 3: Generate PDF filename and full vault path
        const pdfFilename = generatePdfFilename(note, this.filenameTemplate);
        const pdfVaultPath = this.buildVaultPath(this.pdfFolder, note, pdfFilename);

        // Step 4: Ensure PDF folder exists (including any subfolders)
        const folderPath = pdfVaultPath.substring(0, pdfVaultPath.lastIndexOf('/'));
        if (folderPath) {
            await this.ensureFolderExists(folderPath);
        }

        // Step 5: Write PDF to vault
        const existingPdf = this.vault.getAbstractFileByPath(pdfVaultPath);
        if (existingPdf instanceof TFile) {
            await this.vault.modifyBinary(existingPdf, conversionResult.pdfData);
        } else {
            await this.vault.createBinary(pdfVaultPath, conversionResult.pdfData);
        }

        console.debug(`Converted ${note.name} to PDF in ${conversionResult.conversionTimeMs}ms`);

        return pdfVaultPath;
    }

    /**
     * Check if PDF should be updated based on update options
     */
    private shouldUpdatePdf(): boolean {
        if (!this.updateOptions) return true;
        return this.updateOptions.mode === 'all';
    }

    /**
     * Ensure a folder exists in the vault
     */
    private async ensureFolderExists(folderPath: string): Promise<void> {
        const normalizedPath = folderPath.startsWith('/') ? folderPath.slice(1) : folderPath;
        const folder = this.vault.getAbstractFileByPath(normalizedPath);

        if (!folder) {
            // Create folder and any parent folders
            const parts = normalizedPath.split('/');
            let currentPath = '';

            for (const part of parts) {
                currentPath = currentPath ? `${currentPath}/${part}` : part;
                const existing = this.vault.getAbstractFileByPath(currentPath);

                if (!existing) {
                    await this.vault.createFolder(currentPath);
                } else if (!(existing instanceof TFolder)) {
                    throw new Error(`Path ${currentPath} exists but is not a folder`);
                }
            }
        } else if (!(folder instanceof TFolder)) {
            throw new Error(`Path ${normalizedPath} exists but is not a folder`);
        }
    }
}
