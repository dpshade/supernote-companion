import { SupernoteFile, ExportOptions } from '../api/types';

/**
 * Generate markdown content for a Supernote note entry
 */
export function generateMarkdown(
    note: SupernoteFile,
    options: ExportOptions,
    pdfVaultPath?: string,
    thumbnailBase64?: string
): string {
    const frontmatter = generateFrontmatter(note, pdfVaultPath);
    const body = generateBody(note, options, pdfVaultPath, thumbnailBase64);
    
    return `---\n${frontmatter}---\n\n${body}`;
}

/**
 * Generate frontmatter YAML
 */
export function generateFrontmatter(
    note: SupernoteFile,
    pdfVaultPath?: string
): string {
    const lines: string[] = [];
    
    // Note name/title
    lines.push(`name: "${escapeYamlString(note.name)}"`);
    
    // Supernote ID (for matching)
    lines.push(`supernote_id: "${note.id}"`);
    
    // Original source path on Supernote
    lines.push(`source: "${escapeYamlString(note.path)}"`);
    
    // Dates
    const createdDate = formatDate(note.createdAt);
    const modifiedDate = formatDate(note.modifiedAt);
    lines.push(`created: ${createdDate}`);
    lines.push(`modified: ${modifiedDate}`);
    
    // Page count (if available)
    if (note.pageCount !== undefined) {
        lines.push(`pages: ${note.pageCount}`);
    }
    
    // File size (human readable)
    lines.push(`size: "${formatFileSize(note.size)}"`);
    
    // PDF attachment path (if exists)
    if (pdfVaultPath) {
        lines.push(`pdf_attachment: "${escapeYamlString(pdfVaultPath)}"`);
    }
    
    // Default tags
    lines.push(`tags:`);
    lines.push(`  - supernote`);
    
    return lines.join('\n') + '\n';
}

/**
 * Generate the body content of the markdown file
 */
export function generateBody(
    note: SupernoteFile,
    options: ExportOptions,
    pdfVaultPath?: string,
    thumbnailBase64?: string
): string {
    const sections: string[] = [];
    
    // Title
    sections.push(`# ${note.name}\n`);
    
    // Info section
    sections.push(`## Note Information\n`);
    sections.push(`| Property | Value |`);
    sections.push(`|----------|-------|`);
    sections.push(`| **Source** | \`${note.path}\` |`);
    sections.push(`| **Created** | ${formatDateReadable(note.createdAt)} |`);
    sections.push(`| **Modified** | ${formatDateReadable(note.modifiedAt)} |`);
    if (note.pageCount !== undefined) {
        sections.push(`| **Pages** | ${note.pageCount} |`);
    }
    sections.push(`| **Size** | ${formatFileSize(note.size)} |`);
    sections.push('');
    
    // PDF Link (if attached)
    if (options.attachPdf && pdfVaultPath) {
        sections.push(`## PDF Attachment\n`);
        sections.push(`![[${pdfVaultPath}]]\n`);
    }
    
    // Thumbnail (if included)
    if (options.includeThumbnail && thumbnailBase64) {
        sections.push(`## Preview\n`);
        sections.push(`![Thumbnail](${thumbnailBase64})\n`);
    }
    
    // Notes section for user additions
    sections.push(`---\n`);
    sections.push(`## Notes\n`);
    sections.push(`*Add your notes and annotations here...*\n`);
    
    return sections.join('\n');
}

/**
 * Generate a filename for the markdown entry using a template
 * 
 * Supported variables:
 * - {name} - Note name (without .note extension)
 * - {date} - Modified date (YYYY-MM-DD)
 * - {created} - Created date (YYYY-MM-DD)
 * - {modified} - Modified date (YYYY-MM-DD) 
 * - {datetime} - Modified datetime (YYYY-MM-DD_HH-MM)
 * - {pages} - Page count (if available)
 * - {id} - Supernote ID
 * - {year} - Year from modified date
 * - {month} - Month from modified date (01-12)
 * - {day} - Day from modified date (01-31)
 */
export function generateFilename(note: SupernoteFile, template?: string): string {
    const result = applyFilenameTemplate(note, template || '{date} {name}');
    return `${result}.md`;
}

/**
 * Generate a filename for the PDF using a template
 */
export function generatePdfFilename(note: SupernoteFile, template?: string): string {
    const result = applyFilenameTemplate(note, template || '{date} {name}');
    return `${result}.pdf`;
}

/**
 * Apply a filename template to a note
 */
export function applyFilenameTemplate(note: SupernoteFile, template: string): string {
    const modifiedDate = new Date(note.modifiedAt);

    // Clean the note name (remove .note extension if present)
    const cleanName = note.name.replace(/\.note$/i, '');
    
    // Build replacement map
    const replacements: Record<string, string> = {
        '{name}': cleanName,
        '{date}': formatDate(note.modifiedAt),
        '{created}': formatDate(note.createdAt),
        '{modified}': formatDate(note.modifiedAt),
        '{datetime}': formatDateTime(note.modifiedAt),
        '{pages}': note.pageCount?.toString() || '0',
        '{id}': note.id,
        '{year}': modifiedDate.getFullYear().toString(),
        '{month}': (modifiedDate.getMonth() + 1).toString().padStart(2, '0'),
        '{day}': modifiedDate.getDate().toString().padStart(2, '0'),
    };
    
    // Apply replacements
    let result = template;
    for (const [key, value] of Object.entries(replacements)) {
        result = result.split(key).join(value);
    }
    
    // Sanitize the final result
    return sanitizeFilename(result);
}

/**
 * Format a date string as YYYY-MM-DD_HH-MM
 */
function formatDateTime(dateString: string): string {
    const date = new Date(dateString);
    const datePart = date.toISOString().split('T')[0];
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${datePart}_${hours}-${minutes}`;
}

/**
 * Sanitize a string to be used as a filename
 */
export function sanitizeFilename(name: string): string {
    return name
        .replace(/[\\/:*?"<>|]/g, '') // Remove invalid characters
        .replace(/\s+/g, ' ')          // Normalize whitespace
        .trim();
}

/**
 * Escape special characters for YAML strings
 */
function escapeYamlString(str: string): string {
    return str
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"');
}

/**
 * Format a date string as YYYY-MM-DD
 */
function formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toISOString().split('T')[0];
}

/**
 * Format a date string in a human-readable format
 */
function formatDateReadable(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

/**
 * Format file size in human-readable format
 */
export function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    
    const units = ['B', 'KB', 'MB', 'GB'];
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${units[i]}`;
}

/**
 * Format duration in a human-readable format
 */
export function formatDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
}

/**
 * Update frontmatter in existing content while preserving custom fields
 */
export function updateFrontmatter(
    existingContent: string,
    newFrontmatter: Record<string, unknown>,
    preserveCustomFields: boolean,
    fieldsToUpdate?: string[]
): string {
    const frontmatterMatch = existingContent.match(/^---\n([\s\S]*?)\n---/);
    
    if (!frontmatterMatch) {
        // No existing frontmatter, create new
        const yaml = objectToYaml(newFrontmatter);
        return `---\n${yaml}---\n\n${existingContent}`;
    }

    // Parse existing frontmatter
    const existingYaml = frontmatterMatch[1];
    const existingFields = parseSimpleYaml(existingYaml);
    
    // Known fields that come from Supernote
    const knownFields = ['name', 'supernote_id', 'source', 'created', 'modified', 'pages', 'size', 'pdf_attachment', 'tags'];
    
    // Determine which fields to update
    let fieldsToProcess: string[];
    if (fieldsToUpdate && fieldsToUpdate.length > 0) {
        fieldsToProcess = fieldsToUpdate;
    } else {
        fieldsToProcess = Object.keys(newFrontmatter);
    }
    
    // Merge frontmatter
    const mergedFields: Record<string, unknown> = { ...existingFields };
    
    for (const field of fieldsToProcess) {
        if (field in newFrontmatter) {
            mergedFields[field] = newFrontmatter[field];
        }
    }
    
    // Preserve custom fields if requested
    if (preserveCustomFields) {
        for (const field of Object.keys(existingFields)) {
            if (!knownFields.includes(field) && !(field in mergedFields)) {
                mergedFields[field] = existingFields[field];
            }
        }
    }
    
    // Generate new YAML
    const newYaml = objectToYaml(mergedFields);
    
    // Replace frontmatter in content
    const bodyContent = existingContent.slice(frontmatterMatch[0].length);
    return `---\n${newYaml}---${bodyContent}`;
}

/**
 * Convert an object to YAML string
 */
function objectToYaml(obj: Record<string, unknown>): string {
    const lines: string[] = [];
    
    for (const [key, value] of Object.entries(obj)) {
        if (Array.isArray(value)) {
            lines.push(`${key}:`);
            for (const item of value) {
                lines.push(`  - ${typeof item === 'string' ? `"${escapeYamlString(item)}"` : item}`);
            }
        } else if (typeof value === 'string') {
            lines.push(`${key}: "${escapeYamlString(value)}"`);
        } else if (typeof value === 'number' || typeof value === 'boolean') {
            lines.push(`${key}: ${value}`);
        } else if (value === null || value === undefined) {
            lines.push(`${key}: `);
        }
    }
    
    return lines.join('\n') + '\n';
}

/**
 * Simple YAML parser for flat structures
 */
function parseSimpleYaml(yaml: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const lines = yaml.split('\n');
    let currentKey = '';
    let currentArray: string[] = [];
    let isArray = false;
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        
        // Check for array item
        if (trimmed.startsWith('- ')) {
            if (isArray) {
                const value = trimmed.slice(2).replace(/^["']|["']$/g, '');
                currentArray.push(value);
            }
            continue;
        }
        
        // Save previous array if exists
        if (isArray && currentKey) {
            result[currentKey] = currentArray;
            isArray = false;
            currentArray = [];
        }
        
        // Parse key-value
        const colonIndex = trimmed.indexOf(':');
        if (colonIndex === -1) continue;
        
        const key = trimmed.slice(0, colonIndex).trim();
        const value = trimmed.slice(colonIndex + 1).trim();
        
        if (!key) continue;
        currentKey = key;
        
        if (value === '' || value === '|' || value === '>') {
            isArray = true;
            currentArray = [];
        } else {
            result[key] = value.replace(/^["']|["']$/g, '');
        }
    }
    
    // Save final array
    if (isArray && currentKey) {
        result[currentKey] = currentArray;
    }
    
    return result;
}
