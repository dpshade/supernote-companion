import { SupernoteFile, SyncStatus, LocalNoteFile } from '../api/types';
import { TFile } from 'obsidian';

/**
 * Calculate the sync status by comparing remote notes with local files
 */
export function calculateSyncStatus(
    remoteNotes: SupernoteFile[],
    localNotes: Map<string, LocalNoteFile>,
    existingPdfNames?: Map<string, TFile>
): SyncStatus {
    const status: SyncStatus = {
        new: [],
        updated: [],
        synced: []
    };

    remoteNotes.forEach(note => {
        const localFile = localNotes.get(note.id);
        
        // Also check if a PDF with this name already exists (for pdf-only mode)
        const normalizedName = note.name.toLowerCase().replace(/\+/g, ' ');
        const existingPdf = existingPdfNames?.get(normalizedName) || existingPdfNames?.get(note.name.toLowerCase());

        if (!localFile && !existingPdf) {
            // Note doesn't exist locally
            status.new.push(note);
        } else if (localFile) {
            // Compare timestamps to detect updates
            const remoteModified = new Date(note.modifiedAt).getTime();
            const localModified = localFile.mtime;

            if (remoteModified > localModified) {
                // Remote has been modified more recently
                status.updated.push(note);
            } else {
                // Already in sync
                status.synced.push(note);
            }
        } else if (existingPdf) {
            // PDF exists - check if it needs updating
            const remoteModified = new Date(note.modifiedAt).getTime();
            const localModified = existingPdf.stat.mtime;

            if (remoteModified > localModified) {
                status.updated.push(note);
            } else {
                status.synced.push(note);
            }
        }
    });

    return status;
}

/**
 * Filter to only notes that don't exist locally (for import)
 * Also checks for existing PDFs by name for pdf-only mode
 */
export function filterNewNotes(
    remoteNotes: SupernoteFile[],
    localNotes: Map<string, LocalNoteFile>,
    existingPdfNames?: Map<string, TFile>
): SupernoteFile[] {
    return remoteNotes.filter(note => {
        // Check by ID (for markdown mode with frontmatter)
        if (localNotes.has(note.id)) {
            return false;
        }
        
        // Check by PDF name (for pdf-only mode)
        if (existingPdfNames) {
            const normalizedName = note.name.toLowerCase().replace(/\+/g, ' ');
            if (existingPdfNames.has(normalizedName) || existingPdfNames.has(note.name.toLowerCase())) {
                return false;
            }
        }
        
        return true;
    });
}

/**
 * Filter to only notes that exist locally (for update)
 */
export function filterExistingNotes(
    remoteNotes: SupernoteFile[],
    localNotes: Map<string, LocalNoteFile>
): SupernoteFile[] {
    return remoteNotes.filter(note => localNotes.has(note.id));
}

/**
 * Filter notes by modification status
 */
export function filterByModificationStatus(
    notes: SupernoteFile[],
    localNotes: Map<string, LocalNoteFile>,
    lastSync: number,
    includeModified: boolean
): SupernoteFile[] {
    return notes.filter(note => {
        const localFile = localNotes.get(note.id);
        if (!localFile) return true; // New notes always included
        
        const isModified = localFile.mtime > lastSync;
        return includeModified ? true : !isModified;
    });
}

/**
 * Split notes into modified and unmodified groups
 */
export function splitByModificationStatus(
    notes: SupernoteFile[],
    localNotes: Map<string, LocalNoteFile>,
    lastSync: number
): { modified: SupernoteFile[]; unmodified: SupernoteFile[] } {
    const modified: SupernoteFile[] = [];
    const unmodified: SupernoteFile[] = [];

    for (const note of notes) {
        const localFile = localNotes.get(note.id);
        if (localFile && localFile.mtime > lastSync) {
            modified.push(note);
        } else {
            unmodified.push(note);
        }
    }

    return { modified, unmodified };
}

/**
 * Deduplicate notes by ID (in case of API duplicates)
 */
export function deduplicateNotes(notes: SupernoteFile[]): SupernoteFile[] {
    const seenIds = new Set<string>();
    return notes.filter(note => {
        if (seenIds.has(note.id)) return false;
        seenIds.add(note.id);
        return true;
    });
}
