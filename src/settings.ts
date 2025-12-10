import { UpdateMode, FrontmatterField, MergeStrategy } from './api/types';

/**
 * Import mode options
 */
export type ImportMode = 'pdf-only' | 'markdown-with-pdf' | 'markdown-only';

/**
 * PDF converter options
 */
export type ConverterMode = 'cli' | 'builtin';

/**
 * Plugin settings interface
 */
export interface SupernoteCompanionSettings {
    // Device Connection
    deviceIp: string;               // Supernote device IP address (e.g., "192.168.1.100")
    devicePort: number;             // Device port (default: 8089)
    
    // Sync Configuration
    notesFolder: string;            // Vault folder for notes (PDF or markdown depending on mode)
    pdfFolder: string;              // Vault folder for PDF attachments (only used in markdown-with-pdf mode)
    importMode: ImportMode;         // How to import notes
    filenameTemplate: string;       // Template for filenames, supports {name}, {date}, {created}, {modified}, {pages}, {id}
    preserveFolderStructure: boolean; // Preserve folder structure from Supernote device
    trashedNoteIds: string[];       // IDs of notes user has "trashed" (excluded from sync)
    lastSync: number;               // Timestamp of last successful sync
    
    // PDF Converter
    converterMode: ConverterMode;   // 'cli' for supernote_pdf binary, 'builtin' for TypeScript implementation
    converterPath: string;          // Path to supernote_pdf CLI binary (when using 'cli' mode)
    
    // Update Behavior
    updateModifiedFiles: 'skip' | 'overwrite' | 'ask';
    updateMode: UpdateMode;
    specificFrontmatterFields: FrontmatterField[];
    tagsMergeStrategy: MergeStrategy;
    preserveCustomFields: boolean;
    
    // Export Options (only used in markdown modes)
    attachPdf: boolean;
    includeThumbnail: boolean;
    
    // Advanced
    connectionTimeout: number;       // Timeout in ms for device connections
}

/**
 * Default settings values
 */
export const DEFAULT_SETTINGS: SupernoteCompanionSettings = {
    // Device Connection
    deviceIp: '',                   // Must be set by user
    devicePort: 8089,               // Default Supernote Browse & Access port
    
    // Sync Configuration
    notesFolder: '/Supernote',
    pdfFolder: '/Supernote/PDFs',
    importMode: 'pdf-only',         // Default to simple PDF-only import
    filenameTemplate: '{name}',     // Simple default - just use the note name
    preserveFolderStructure: true,  // Preserve Supernote folder structure by default
    trashedNoteIds: [],
    lastSync: 0,
    
    // PDF Converter
    converterMode: 'cli',           // Default to CLI (more reliable)
    converterPath: '/home/dpshade/Developer/supernote_obsidian/supernote_pdf/target/release/supernote_pdf',
    
    // Update Behavior
    updateModifiedFiles: 'ask',
    updateMode: 'all',
    specificFrontmatterFields: [],
    tagsMergeStrategy: 'merge',
    preserveCustomFields: true,
    
    // Export Options
    attachPdf: true,
    includeThumbnail: false,
    
    // Advanced
    connectionTimeout: 10000,
};
