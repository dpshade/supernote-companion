import { Vault, TFile } from 'obsidian';
import { LocalNoteFile } from '../api/types';

/**
 * Scan the vault for existing synced Supernote files.
 * 
 * Supports two modes:
 * 1. Markdown files with frontmatter containing 'supernote_id'
 * 2. PDF files that were imported directly (matched by filename)
 */
export async function scanLocalNotes(
    vault: Vault,
    folderPath: string
): Promise<Map<string, LocalNoteFile>> {
    const localNotes = new Map<string, LocalNoteFile>();

    // Normalize folder path
    const normalizedFolder = folderPath.startsWith('/') ? folderPath.slice(1) : folderPath;

    // Scan markdown files with frontmatter
    const mdFiles = vault.getMarkdownFiles().filter(file => 
        file.path.startsWith(normalizedFolder)
    );

    for (const file of mdFiles) {
        try {
            const content = await vault.read(file);
            const frontmatter = parseFrontmatter(content);

            // Check if this file has a Supernote source
            if (frontmatter.source && frontmatter.supernote_id) {
                const id = String(frontmatter.supernote_id);
                
                localNotes.set(id, {
                    path: file.path,
                    id: id,
                    sourcePath: String(frontmatter.source),
                    mtime: file.stat.mtime,
                    pdfPath: frontmatter.pdf_attachment ? String(frontmatter.pdf_attachment) : undefined,
                });
            }
        } catch (error) {
            console.error(`Failed to process markdown file ${file.path}:`, error);
        }
    }

    // Scan PDF files (for pdf-only import mode)
    const allFiles = vault.getFiles().filter(file => 
        file.path.startsWith(normalizedFolder) && file.extension === 'pdf'
    );

    for (const file of allFiles) {
        // Extract the note name from the PDF filename
        // The filename format is typically: {name}.pdf or template-based
        const basename = file.basename; // filename without extension
        
        // Generate an ID that matches how client.ts generates IDs
        // This is a hash-based ID from the presumed source path
        // We'll store by basename to allow matching
        const pdfId = `pdf:${basename}`;
        
        // Only add if not already tracked via markdown
        if (!localNotes.has(pdfId)) {
            localNotes.set(pdfId, {
                path: file.path,
                id: pdfId,
                sourcePath: '', // Unknown for standalone PDFs
                mtime: file.stat.mtime,
                pdfPath: file.path,
            });
        }
    }

    return localNotes;
}

/**
 * Scan for local PDF files and create a map by note name for quick lookup
 * This is used for pdf-only mode to check if a note already exists
 */
export function scanLocalPdfsByName(
    vault: Vault,
    folderPath: string
): Map<string, TFile> {
    const pdfsByName = new Map<string, TFile>();

    // Normalize folder path
    const normalizedFolder = folderPath.startsWith('/') ? folderPath.slice(1) : folderPath;

    // Get all PDF files in the folder (recursively)
    const allFiles = vault.getFiles().filter(file =>
        file.path.startsWith(normalizedFolder) && file.extension === 'pdf'
    );

    for (const file of allFiles) {
        // Use basename (without extension) as the key
        // Normalize: lowercase and replace + with space for matching
        const normalizedName = file.basename.toLowerCase().replace(/\+/g, ' ');
        pdfsByName.set(normalizedName, file);

        // Also store with the original basename for exact matches
        pdfsByName.set(file.basename.toLowerCase(), file);
    }

    return pdfsByName;
}

/**
 * Get a local note file by its Supernote ID
 */
export async function getLocalNoteById(
    vault: Vault,
    folderPath: string,
    noteId: string
): Promise<LocalNoteFile | null> {
    const localNotes = await scanLocalNotes(vault, folderPath);
    return localNotes.get(noteId) || null;
}

/**
 * Find the TFile for a local note by ID
 */
export async function findLocalNoteFile(
    vault: Vault,
    folderPath: string,
    noteId: string
): Promise<TFile | null> {
    const localNote = await getLocalNoteById(vault, folderPath, noteId);
    if (!localNote) return null;
    
    const file = vault.getAbstractFileByPath(localNote.path);
    return file instanceof TFile ? file : null;
}

/**
 * Parse frontmatter from markdown content
 */
export function parseFrontmatter(content: string): Record<string, unknown> {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};

    const yaml = match[1];
    const frontmatter: Record<string, unknown> = {};
    
    // Simple YAML parsing (handles basic key-value pairs and arrays)
    const lines = yaml.split('\n');
    let currentKey = '';
    let isArray = false;
    let arrayValues: string[] = [];

    for (const line of lines) {
        // Check if this is an array item
        if (line.match(/^\s+-\s+/)) {
            if (isArray && currentKey) {
                const value = line.replace(/^\s+-\s+/, '').trim();
                // Handle quoted values
                const unquoted = value.replace(/^["']|["']$/g, '');
                // Handle wikilinks
                const cleaned = unquoted.replace(/^\[\[|\]\]$/g, '');
                arrayValues.push(cleaned);
            }
            continue;
        }

        // If we were building an array, save it
        if (isArray && currentKey) {
            frontmatter[currentKey] = arrayValues;
            isArray = false;
            arrayValues = [];
        }

        // Parse key-value pair
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) continue;

        const key = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim();

        if (!key) continue;

        currentKey = key;

        if (value === '' || value === '|' || value === '>') {
            // This might be the start of an array or multiline value
            isArray = true;
            arrayValues = [];
        } else if (value.startsWith('[') && value.endsWith(']')) {
            // Inline array
            const items = value.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
            frontmatter[key] = items;
        } else {
            // Regular value - remove quotes
            frontmatter[key] = value.replace(/^["']|["']$/g, '');
        }
    }

    // Don't forget to save the last array if we were building one
    if (isArray && currentKey) {
        frontmatter[currentKey] = arrayValues;
    }

    return frontmatter;
}

/**
 * Extract the ID from a Supernote source path
 * The ID is typically the file path itself or a hash of it
 */
export function extractIdFromPath(sourcePath: string): string {
    // Use the full path as the ID (normalized)
    return sourcePath.replace(/\\/g, '/').toLowerCase();
}

/**
 * Generate a unique ID for a note file based on its path
 */
export function generateNoteId(notePath: string): string {
    // Create a simple hash-like ID from the path
    const normalized = notePath.replace(/\\/g, '/');
    // Use btoa for base64 encoding, but make it URL-safe
    const encoded = btoa(normalized)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    return encoded;
}

/**
 * Check if a note has been modified locally since the last sync
 */
export function isLocallyModified(
    localFile: LocalNoteFile,
    lastSync: number
): boolean {
    return localFile.mtime > lastSync;
}
