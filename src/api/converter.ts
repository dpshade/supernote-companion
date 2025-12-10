/**
 * PDF Converter for Supernote .note files
 * 
 * Supports two modes:
 * 1. CLI mode (recommended): Uses the supernote_pdf Rust binary for reliable conversion
 * 2. Built-in mode: Uses a TypeScript implementation (less reliable, but no external dependency)
 */

import { convertNoteToPdf, getNoteInfo } from './note-parser';
import { ConverterMode } from '../settings';

// Use Node.js APIs available in Electron
const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Common locations to search for supernote_pdf binary
 */
const CLI_SEARCH_PATHS = [
    // User's home directory
    path.join(os.homedir(), '.local', 'bin', 'supernote_pdf'),
    path.join(os.homedir(), 'bin', 'supernote_pdf'),
    // System paths
    '/usr/local/bin/supernote_pdf',
    '/usr/bin/supernote_pdf',
    // Cargo install location
    path.join(os.homedir(), '.cargo', 'bin', 'supernote_pdf'),
];

/**
 * Result of a PDF conversion operation
 */
export interface ConversionResult {
    success: boolean;
    pdfData?: ArrayBuffer;
    error?: string;
    conversionTimeMs?: number;
    pageCount?: number;
}

/**
 * Result of a batch directory conversion
 */
export interface BatchConversionResult {
    success: boolean;
    outputDir: string;
    error?: string;
    conversionTimeMs?: number;
    fileCount?: number;
}

/**
 * Information about a .note file
 */
export interface NoteInfo {
    signature: string;
    pageCount: number;
    width: number;
    height: number;
}

/**
 * Promisified exec
 */
function execAsync(cmd: string): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        exec(cmd, (error: Error | null, stdout: string, stderr: string) => {
            if (error) {
                reject(error);
            } else {
                resolve({ stdout, stderr });
            }
        });
    });
}

/**
 * Try to find supernote_pdf in PATH using `which`
 */
function findInPath(): string | null {
    try {
        const result = execSync('which supernote_pdf', { encoding: 'utf8', timeout: 5000 });
        return result.trim() || null;
    } catch {
        return null;
    }
}

/**
 * Search for supernote_pdf in common locations
 */
function findCliTool(configuredPath?: string): string | null {
    // First, try the configured path
    if (configuredPath) {
        try {
            fs.accessSync(configuredPath, fs.constants.X_OK);
            return configuredPath;
        } catch {
            // Configured path doesn't work, continue searching
        }
    }

    // Try to find in PATH
    const pathResult = findInPath();
    if (pathResult) {
        return pathResult;
    }

    // Search common locations
    for (const searchPath of CLI_SEARCH_PATHS) {
        try {
            fs.accessSync(searchPath, fs.constants.X_OK);
            return searchPath;
        } catch {
            // Not found here, continue
        }
    }

    return null;
}

/**
 * PdfConverter handles converting .note files to PDF.
 * 
 * Supports two modes:
 * - 'cli': Uses the supernote_pdf Rust binary (recommended, more reliable)
 * - 'builtin': Uses TypeScript implementation (no external dependency, less reliable)
 */
export class PdfConverter {
    private mode: ConverterMode;
    private cliPath: string;
    private resolvedCliPath: string | null = null;

    constructor(mode: ConverterMode = 'cli', cliPath: string = '') {
        this.mode = mode;
        this.cliPath = cliPath;
        
        // Auto-detect CLI path if in CLI mode
        if (mode === 'cli') {
            this.resolvedCliPath = findCliTool(cliPath);
            if (this.resolvedCliPath) {
                console.log(`[converter] Found CLI tool at: ${this.resolvedCliPath}`);
            }
        }
    }

    /**
     * Update converter settings
     */
    setMode(mode: ConverterMode, cliPath?: string): void {
        this.mode = mode;
        if (cliPath !== undefined) {
            this.cliPath = cliPath;
        }
        // Re-resolve CLI path
        if (mode === 'cli') {
            this.resolvedCliPath = findCliTool(this.cliPath);
        }
    }

    /**
     * Get the resolved CLI path (for display in settings)
     */
    getResolvedCliPath(): string | null {
        return this.resolvedCliPath;
    }

    /**
     * Check if the PDF conversion is available
     */
    async isToolAvailable(): Promise<boolean> {
        if (this.mode === 'builtin') {
            return true;
        }

        // Re-check for CLI tool
        this.resolvedCliPath = findCliTool(this.cliPath);
        return this.resolvedCliPath !== null;
    }

    /**
     * Get the version of the converter
     */
    async getToolVersion(): Promise<string> {
        if (this.mode === 'builtin') {
            return 'built-in v1.0.0 (TypeScript implementation - experimental)';
        }

        const cliPath = this.resolvedCliPath || findCliTool(this.cliPath);
        if (!cliPath) {
            return 'CLI not found - install supernote_pdf or set path in settings';
        }

        try {
            const { stdout } = await execAsync(`"${cliPath}" --version`);
            return `CLI: ${stdout.trim()} (${cliPath})`;
        } catch {
            return `CLI: version unknown (${cliPath})`;
        }
    }

    /**
     * Get information about a .note file without converting it
     * Note: Only works with built-in mode
     */
    getInfo(noteData: ArrayBuffer): NoteInfo {
        return getNoteInfo(noteData);
    }

    /**
     * Convert a .note file to PDF
     * @param noteData The raw .note file data
     * @param noteId Optional identifier for logging
     * @returns ConversionResult with the PDF data or error information
     */
    async convert(noteData: ArrayBuffer, noteId?: string): Promise<ConversionResult> {
        console.log(`[converter] Mode: ${this.mode}, CLI path: ${this.cliPath || '(not set)'}`);
        
        if (this.mode === 'cli') {
            return this.convertWithCli(noteData, noteId);
        } else {
            return this.convertWithBuiltin(noteData, noteId);
        }
    }

    /**
     * Convert using the supernote_pdf CLI binary
     */
    private async convertWithCli(noteData: ArrayBuffer, noteId?: string): Promise<ConversionResult> {
        const startTime = Date.now();
        const fileId = noteId || 'unknown';

        // Try to find CLI tool if not already resolved
        const cliPath = this.resolvedCliPath || findCliTool(this.cliPath);
        
        if (!cliPath) {
            console.error('[converter-cli] CLI tool not found');
            console.error('[converter-cli] Searched: configured path, PATH, and common locations');
            console.error('[converter-cli] Install supernote_pdf: cargo install supernote_pdf');
            return {
                success: false,
                error: 'supernote_pdf CLI not found. Install it with: cargo install supernote_pdf (requires Rust). Or switch to built-in mode in settings.',
                conversionTimeMs: Date.now() - startTime,
            };
        }
        
        // Cache the resolved path
        this.resolvedCliPath = cliPath;

        // Early validation
        if (!noteData || noteData.byteLength === 0) {
            console.error(`[converter-cli] File "${fileId}" is empty - download may have failed`);
            return {
                success: false,
                error: `File "${fileId}" is empty (0 bytes) - download may have failed`,
                conversionTimeMs: Date.now() - startTime,
            };
        }

        console.log(`[converter-cli] Starting conversion of "${fileId}" (${noteData.byteLength} bytes) using ${cliPath}`);

        // Create temp files for input and output
        const tempDir = os.tmpdir();
        const inputPath = path.join(tempDir, `supernote_${Date.now()}_${Math.random().toString(36).slice(2)}.note`);
        const outputPath = inputPath.replace('.note', '.pdf');

        try {
            // Write input file
            await fs.promises.writeFile(inputPath, Buffer.from(noteData));
            console.log(`[converter-cli] Wrote temp input file: ${inputPath}`);

            // Run the CLI converter
            const cmd = `"${cliPath}" --input "${inputPath}" --output "${outputPath}"`;
            console.log(`[converter-cli] Running: ${cmd}`);
            
            const { stdout, stderr } = await execAsync(cmd);
            if (stdout) console.log(`[converter-cli] stdout: ${stdout}`);
            if (stderr) console.log(`[converter-cli] stderr: ${stderr}`);

            // Read the output PDF
            const pdfBuffer = await fs.promises.readFile(outputPath);
            const pdfData = pdfBuffer.buffer.slice(pdfBuffer.byteOffset, pdfBuffer.byteOffset + pdfBuffer.byteLength);

            const conversionTimeMs = Date.now() - startTime;
            console.log(`[converter-cli] Successfully converted "${fileId}" in ${conversionTimeMs}ms, PDF size: ${pdfData.byteLength} bytes`);

            return {
                success: true,
                pdfData,
                conversionTimeMs,
            };

        } catch (error) {
            const conversionTimeMs = Date.now() - startTime;
            const errorMsg = error instanceof Error ? error.message : String(error);
            
            console.error(`[converter-cli] PDF conversion failed for "${fileId}":`, error);

            return {
                success: false,
                error: `CLI conversion failed: ${errorMsg}`,
                conversionTimeMs,
            };

        } finally {
            // Clean up temp files
            try {
                await fs.promises.unlink(inputPath).catch(() => {});
                await fs.promises.unlink(outputPath).catch(() => {});
            } catch {
                // Ignore cleanup errors
            }
        }
    }

    /**
     * Convert using the built-in TypeScript implementation
     */
    private async convertWithBuiltin(noteData: ArrayBuffer, noteId?: string): Promise<ConversionResult> {
        const startTime = Date.now();
        const fileId = noteId || 'unknown';

        // Early validation with context
        if (!noteData || noteData.byteLength === 0) {
            console.error(`[converter-builtin] File "${fileId}" is empty - download may have failed`);
            return {
                success: false,
                error: `File "${fileId}" is empty (0 bytes) - download may have failed`,
                conversionTimeMs: Date.now() - startTime,
            };
        }

        console.log(`[converter-builtin] Starting conversion of "${fileId}" (${noteData.byteLength} bytes)`);

        try {
            // Get note info first (this also validates the file)
            const info = getNoteInfo(noteData);
            
            // Convert to PDF
            const pdfData = await convertNoteToPdf(noteData);

            const conversionTimeMs = Date.now() - startTime;

            console.log(`[converter-builtin] Successfully converted "${fileId}" (${info.pageCount} pages) in ${conversionTimeMs}ms`);

            return {
                success: true,
                pdfData,
                conversionTimeMs,
                pageCount: info.pageCount,
            };

        } catch (error) {
            const conversionTimeMs = Date.now() - startTime;
            const errorMsg = error instanceof Error ? error.message : String(error);
            
            console.error(`[converter-builtin] PDF conversion failed for "${fileId}":`, {
                error: errorMsg,
                fileSize: noteData.byteLength,
                conversionTimeMs,
            });

            return {
                success: false,
                error: `${errorMsg} (file: ${fileId}, size: ${noteData.byteLength} bytes)`,
                conversionTimeMs,
            };
        }
    }

    /**
     * Convert multiple .note files in sequence (legacy method)
     */
    async convertBatch(
        notes: Array<{ id: string; data: ArrayBuffer }>,
        onProgress?: (current: number, total: number, id: string) => void
    ): Promise<Map<string, ConversionResult>> {
        const results = new Map<string, ConversionResult>();

        for (let i = 0; i < notes.length; i++) {
            const { id, data } = notes[i];
            
            if (onProgress) {
                onProgress(i + 1, notes.length, id);
            }

            const result = await this.convert(data, id);
            results.set(id, result);
        }

        return results;
    }

    /**
     * Check if batch directory conversion is available (CLI mode only)
     */
    canBatchConvert(): boolean {
        return this.mode === 'cli' && this.resolvedCliPath !== null;
    }

    /**
     * Convert an entire directory of .note files to PDFs using CLI batch mode.
     * This is MUCH faster than converting files one by one.
     * 
     * @param inputDir Directory containing .note files (can have subdirectories)
     * @param outputDir Directory where PDFs will be written (preserves folder structure)
     * @returns BatchConversionResult with success status and timing info
     */
    async convertDirectory(inputDir: string, outputDir: string): Promise<BatchConversionResult> {
        const startTime = Date.now();

        if (this.mode !== 'cli') {
            return {
                success: false,
                outputDir,
                error: 'Batch directory conversion only available in CLI mode',
                conversionTimeMs: Date.now() - startTime,
            };
        }

        const cliPath = this.resolvedCliPath || findCliTool(this.cliPath);
        if (!cliPath) {
            return {
                success: false,
                outputDir,
                error: 'supernote_pdf CLI not found',
                conversionTimeMs: Date.now() - startTime,
            };
        }

        console.log(`[converter-cli] Starting batch conversion: ${inputDir} -> ${outputDir}`);

        try {
            // Run the CLI converter in directory mode
            const cmd = `"${cliPath}" --input "${inputDir}" --output "${outputDir}"`;
            console.log(`[converter-cli] Running: ${cmd}`);
            
            const { stdout, stderr } = await execAsync(cmd);
            if (stdout) console.log(`[converter-cli] stdout: ${stdout}`);
            if (stderr) console.log(`[converter-cli] stderr: ${stderr}`);

            const conversionTimeMs = Date.now() - startTime;
            
            // Count output files
            let fileCount = 0;
            try {
                const countPdfs = (dir: string): number => {
                    let count = 0;
                    const entries = fs.readdirSync(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        const fullPath = path.join(dir, entry.name);
                        if (entry.isDirectory()) {
                            count += countPdfs(fullPath);
                        } else if (entry.name.endsWith('.pdf')) {
                            count++;
                        }
                    }
                    return count;
                };
                fileCount = countPdfs(outputDir);
            } catch {
                // Ignore count errors
            }

            console.log(`[converter-cli] Batch conversion complete: ${fileCount} PDFs in ${conversionTimeMs}ms`);

            return {
                success: true,
                outputDir,
                conversionTimeMs,
                fileCount,
            };

        } catch (error) {
            const conversionTimeMs = Date.now() - startTime;
            const errorMsg = error instanceof Error ? error.message : String(error);
            
            console.error(`[converter-cli] Batch conversion failed:`, error);

            return {
                success: false,
                outputDir,
                error: `CLI batch conversion failed: ${errorMsg}`,
                conversionTimeMs,
            };
        }
    }

    /**
     * Create a temporary directory for batch operations
     * @param createDir - If true, creates the directory. If false, just returns the path (for CLI output dirs)
     */
    createTempDir(prefix: string, createDir: boolean = true): string {
        const tempBase = os.tmpdir();
        const dirName = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const tempDir = path.join(tempBase, dirName);
        if (createDir) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        return tempDir;
    }

    /**
     * Clean up a temporary directory
     */
    async cleanupTempDir(tempDir: string): Promise<void> {
        try {
            const removeRecursive = async (dir: string) => {
                const entries = await fs.promises.readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        await removeRecursive(fullPath);
                    } else {
                        await fs.promises.unlink(fullPath);
                    }
                }
                await fs.promises.rmdir(dir);
            };
            await removeRecursive(tempDir);
        } catch (error) {
            console.warn(`[converter] Failed to cleanup temp dir ${tempDir}:`, error);
        }
    }

    /**
     * Write a .note file to a temp directory, preserving relative path
     */
    async writeNoteToTempDir(tempDir: string, relativePath: string, data: ArrayBuffer): Promise<string> {
        const fullPath = path.join(tempDir, relativePath);
        const dir = path.dirname(fullPath);
        
        // Ensure subdirectory exists
        await fs.promises.mkdir(dir, { recursive: true });
        
        // Write the file
        await fs.promises.writeFile(fullPath, Buffer.from(data));
        
        return fullPath;
    }
}
