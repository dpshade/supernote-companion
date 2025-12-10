/**
 * Represents a Supernote .note file from the device
 */
export interface SupernoteFile {
    id: string;
    name: string;
    path: string;           // Full path on device (e.g., "/Note/Meeting.note")
    size: number;           // File size in bytes
    modifiedAt: string;     // ISO date string
    createdAt: string;      // ISO date string
    pageCount?: number;     // Number of pages (if available)
}

/**
 * Extended details for a note file (after conversion)
 */
export interface SupernoteFileDetail extends SupernoteFile {
    pdfPath?: string;       // Path to converted PDF (if exists)
    thumbnail?: string;     // Base64 thumbnail image (if available)
}

/**
 * Represents a local file in the Obsidian vault that was synced from Supernote
 */
export interface LocalNoteFile {
    path: string;           // Vault path to the markdown file
    id: string;             // Supernote file ID (from frontmatter source)
    sourcePath: string;     // Original path on Supernote device
    mtime: number;          // Last modified timestamp
    pdfPath?: string;       // Path to associated PDF attachment
}

/**
 * Export options for controlling what content is included
 */
export interface ExportOptions {
    includeThumbnail: boolean;
    attachPdf: boolean;
}

/**
 * Update mode options
 */
export type UpdateMode = 
    | 'all' 
    | 'frontmatter-only' 
    | 'content-only' 
    | 'specific-frontmatter';

/**
 * Frontmatter fields that can be selectively updated
 */
export type FrontmatterField = 
    | 'name'
    | 'source' 
    | 'date' 
    | 'pageCount'
    | 'size'
    | 'tags';

/**
 * Options for how arrays should be merged during updates
 */
export type MergeStrategy = 'replace' | 'merge';

/**
 * Configuration for selective updates
 */
export interface UpdateOptions {
    mode: UpdateMode;
    specificFields?: FrontmatterField[];
    preserveCustomFields: boolean;
    arrayMergeStrategy: {
        tags: MergeStrategy;
    };
    exportOptions: ExportOptions;
}

/**
 * Preview of what will change during an update
 */
export interface UpdatePreview {
    hasChanges: boolean;
    frontmatterChanges: Array<{
        field: string;
        oldValue: unknown;
        newValue: unknown;
    }>;
    contentChanged: boolean;
    customFieldsPreserved: string[];
}

/**
 * Preview data for a single note update
 */
export interface NoteUpdatePreview {
    note: SupernoteFile;
    localFile: LocalNoteFile;
    preview: UpdatePreview;
}

/**
 * Sync status categorization
 */
export interface SyncStatus {
    new: SupernoteFile[];
    updated: SupernoteFile[];
    synced: SupernoteFile[];
}

/**
 * Server connection status
 */
export interface ConnectionStatus {
    connected: boolean;
    serverUrl: string;
    lastChecked: number;
    error?: string;
}
