import { SupernoteFile } from '../api/types';

/**
 * Apply all configured filters to the notes list
 */
export function filterNotes(
    notes: SupernoteFile[],
    trashedNoteIds: string[],
    additionalFilters?: {
        excludePatterns?: RegExp[];
        includePatterns?: RegExp[];
        minSize?: number;
        maxSize?: number;
        afterDate?: Date;
        beforeDate?: Date;
    }
): SupernoteFile[] {
    let filtered = notes;

    // Filter trashed notes
    filtered = filtered.filter(note => !trashedNoteIds.includes(note.id));

    // Apply additional filters if provided
    if (additionalFilters) {
        // Exclude patterns (e.g., "Today's Highlights" equivalent)
        if (additionalFilters.excludePatterns) {
            filtered = filtered.filter(note => 
                !additionalFilters.excludePatterns!.some(pattern => pattern.test(note.name))
            );
        }

        // Include patterns (only include matching)
        if (additionalFilters.includePatterns && additionalFilters.includePatterns.length > 0) {
            filtered = filtered.filter(note => 
                additionalFilters.includePatterns!.some(pattern => pattern.test(note.name))
            );
        }

        // Size filters
        if (additionalFilters.minSize !== undefined) {
            filtered = filtered.filter(note => note.size >= additionalFilters.minSize!);
        }
        if (additionalFilters.maxSize !== undefined) {
            filtered = filtered.filter(note => note.size <= additionalFilters.maxSize!);
        }

        // Date filters
        if (additionalFilters.afterDate) {
            filtered = filtered.filter(note => 
                new Date(note.modifiedAt) >= additionalFilters.afterDate!
            );
        }
        if (additionalFilters.beforeDate) {
            filtered = filtered.filter(note => 
                new Date(note.modifiedAt) <= additionalFilters.beforeDate!
            );
        }
    }

    return filtered;
}

/**
 * Sort notes by various criteria
 */
export function sortNotes(
    notes: SupernoteFile[],
    sortBy: 'name' | 'date' | 'size' | 'path' = 'date',
    ascending: boolean = true
): SupernoteFile[] {
    const sorted = [...notes].sort((a, b) => {
        let comparison = 0;
        
        switch (sortBy) {
            case 'name':
                comparison = a.name.localeCompare(b.name);
                break;
            case 'date':
                comparison = new Date(a.modifiedAt).getTime() - new Date(b.modifiedAt).getTime();
                break;
            case 'size':
                comparison = a.size - b.size;
                break;
            case 'path':
                comparison = a.path.localeCompare(b.path);
                break;
        }
        
        return ascending ? comparison : -comparison;
    });

    return sorted;
}

/**
 * Group notes by directory path
 */
export function groupNotesByDirectory(notes: SupernoteFile[]): Map<string, SupernoteFile[]> {
    const groups = new Map<string, SupernoteFile[]>();

    for (const note of notes) {
        // Extract directory from path
        const lastSlash = note.path.lastIndexOf('/');
        const directory = lastSlash > 0 ? note.path.slice(0, lastSlash) : '/';
        
        if (!groups.has(directory)) {
            groups.set(directory, []);
        }
        groups.get(directory)!.push(note);
    }

    return groups;
}

/**
 * Search notes by name (case-insensitive)
 */
export function searchNotes(notes: SupernoteFile[], query: string): SupernoteFile[] {
    const lowerQuery = query.toLowerCase();
    return notes.filter(note => 
        note.name.toLowerCase().includes(lowerQuery) ||
        note.path.toLowerCase().includes(lowerQuery)
    );
}
