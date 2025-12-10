import { requestUrl, RequestUrlParam } from 'obsidian';
import { SupernoteFile, SupernoteFileDetail, ConnectionStatus } from './types';

/**
 * Response structure from Supernote device's embedded JSON
 */
interface SupernoteDeviceResponse {
    deviceName: string;
    fileList: SupernoteDeviceFile[];
}

/**
 * File metadata as returned by the Supernote device
 */
interface SupernoteDeviceFile {
    uri: string;
    extension: string | null;
    date: string;           // Format: "YYYY-MM-DD HH:MM"
    size: number;
    isDirectory: boolean;
}

/**
 * API client for communicating directly with the Supernote device's built-in web server.
 * 
 * The Supernote device exposes a simple HTTP server on port 8089 when "Browse & Access" is enabled.
 * This client parses the HTML responses to extract the embedded JSON file listings.
 */
export class SupernoteAPIClient {
    private deviceIp: string;
    private port: number;
    private timeout: number;

    // Regex to extract JSON from the HTML response
    private static readonly RE_JSON = /const json = '({[^']+})'/;

    constructor(deviceIp: string, port: number = 8089, timeout: number = 10000) {
        this.deviceIp = deviceIp;
        this.port = port;
        this.timeout = timeout;
    }

    /**
     * Get the base URL for the Supernote device
     */
    private get baseURL(): string {
        return `http://${this.deviceIp}:${this.port}`;
    }

    /**
     * Update the device connection settings
     */
    updateConnection(deviceIp: string, port: number = 8089): void {
        this.deviceIp = deviceIp;
        this.port = port;
    }

    /**
     * Check if the Supernote device is reachable
     * Uses a GET request to the root path and looks for the embedded JSON
     */
    async checkConnection(): Promise<ConnectionStatus> {
        try {
            const params: RequestUrlParam = {
                url: `${this.baseURL}/`,
                method: 'GET',
                throw: false,
            };

            const response = await requestUrl(params);
            
            // Check if response contains the expected JSON structure
            const hasJson = Boolean(response.text && SupernoteAPIClient.RE_JSON.test(response.text));
            
            return {
                connected: response.status === 200 && hasJson,
                serverUrl: this.baseURL,
                lastChecked: Date.now(),
            };
        } catch (error) {
            return {
                connected: false,
                serverUrl: this.baseURL,
                lastChecked: Date.now(),
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }

    /**
     * Validate the connection is working
     */
    async validateConnection(): Promise<boolean> {
        const status = await this.checkConnection();
        return status.connected;
    }

    /**
     * Fetch list of all .note files from the Supernote device
     * Recursively scans the Note directory
     */
    async fetchNoteFiles(): Promise<{ data: SupernoteFile[] }> {
        try {
            const allNotes: SupernoteFile[] = [];
            await this.scanDirectory('/Note', allNotes);
            return { data: allNotes };
        } catch (error) {
            console.error('Failed to fetch note files:', error);
            throw new Error(`Failed to fetch notes: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Recursively scan a directory for .note files
     */
    private async scanDirectory(path: string, results: SupernoteFile[]): Promise<void> {
        const response = await this.listDirectory(path);
        
        for (const file of response.fileList) {
            if (file.isDirectory) {
                // Recursively scan subdirectories
                await this.scanDirectory(file.uri, results);
            } else if (file.extension === 'note') {
                // Convert device file format to our SupernoteFile format
                results.push(this.convertToSupernoteFile(file));
            }
        }
    }

    /**
     * List contents of a directory on the Supernote device
     */
    private async listDirectory(path: string): Promise<SupernoteDeviceResponse> {
        const params: RequestUrlParam = {
            url: `${this.baseURL}${path}`,
            method: 'GET',
            throw: false,
        };

        const response = await requestUrl(params);
        
        if (response.status >= 400) {
            throw new Error(`HTTP ${response.status}: Failed to list directory ${path}`);
        }

        // Extract JSON from HTML response
        const match = response.text.match(SupernoteAPIClient.RE_JSON);
        if (!match) {
            throw new Error(`No JSON data found in response for ${path}`);
        }

        try {
            return JSON.parse(match[1]) as SupernoteDeviceResponse;
        } catch (e) {
            throw new Error(`Failed to parse JSON from device response: ${e}`);
        }
    }

    /**
     * Convert device file format to our internal SupernoteFile format
     */
    private convertToSupernoteFile(file: SupernoteDeviceFile): SupernoteFile {
        // Parse the date from "YYYY-MM-DD HH:MM" format
        const dateStr = file.date;
        const parsedDate = new Date(dateStr.replace(' ', 'T') + ':00');
        
        // Extract filename from URI and decode properly
        // Note: Supernote uses + for spaces in URLs, but decodeURIComponent doesn't handle +
        const decodedUri = decodeURIComponent(file.uri).replace(/\+/g, ' ');
        const rawName = decodedUri.split('/').pop()?.replace('.note', '') || 'Untitled';
        // Clean up the name: convert + to spaces (for user-created filenames with spaces)
        const name = rawName
            .replace(/\+/g, ' ')           // + to space (redundant but safe)
            .replace(/\s+/g, ' ')          // normalize multiple spaces
            .trim();
        
        // Generate a stable ID from the URI path
        const id = this.generateFileId(file.uri);

        return {
            id,
            name,
            path: decodedUri,
            size: file.size,
            modifiedAt: parsedDate.toISOString(),
            createdAt: parsedDate.toISOString(), // Device doesn't provide creation date separately
            pageCount: undefined, // Not available from directory listing
        };
    }

    /**
     * Generate a stable ID from the file path
     * Uses a simple hash of the URI
     */
    private generateFileId(uri: string): string {
        // Simple hash function for stable IDs
        let hash = 0;
        for (let i = 0; i < uri.length; i++) {
            const char = uri.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return `sn-${Math.abs(hash).toString(16)}`;
    }

    /**
     * Fetch details for a specific note file
     * Note: The device doesn't provide detailed metadata, so this returns basic info
     */
    async fetchNoteDetail(id: string): Promise<SupernoteFileDetail> {
        // We need to find the file by scanning - the device doesn't support direct ID lookup
        const { data: notes } = await this.fetchNoteFiles();
        const note = notes.find(n => n.id === id);
        
        if (!note) {
            throw new Error(`Note with id ${id} not found`);
        }

        return { ...note };
    }

    /**
     * Download a .note file from the Supernote device
     * @param filePath The path to the file on the device (e.g., "/Note/MyNote.note")
     * @returns The raw file data as ArrayBuffer
     */
    async downloadNoteFile(filePath: string): Promise<ArrayBuffer> {
        try {
            // Encode path components for URL safety
            // The Supernote device uses + to represent spaces in URLs (form-style encoding)
            // We need to:
            // 1. Encode special characters with encodeURIComponent
            // 2. Convert %20 (space) to + (device expects + for spaces)
            // 3. Convert %2B back to + (device expects literal + not encoded)
            const encodedPath = filePath.split('/').map(segment => {
                let encoded = encodeURIComponent(segment);
                // Device uses + for spaces
                encoded = encoded.replace(/%20/g, '+');
                // Device expects literal + not %2B
                encoded = encoded.replace(/%2B/g, '+');
                return encoded;
            }).join('/');
            const fullUrl = `${this.baseURL}${encodedPath}`;
            
            console.debug(`[client] Downloading: ${fullUrl}`);
            
            const params: RequestUrlParam = {
                url: fullUrl,
                method: 'GET',
                throw: false,
            };

            const response = await requestUrl(params);
            
            console.debug(`[client] Response for ${filePath}: status=${response.status}, size=${response.arrayBuffer.byteLength}, content-type=${response.headers['content-type'] || 'unknown'}`);
            
            if (response.status >= 400) {
                throw new Error(`HTTP ${response.status}: Failed to download ${filePath}`);
            }

            // Check if we got HTML instead of binary data (device returns HTML for errors with 200 status)
            const contentType = response.headers['content-type'] || '';
            if (contentType.includes('text/html')) {
                // This is likely an error page, not the actual file
                console.warn(`[client] Received HTML instead of binary for ${filePath} - device may have returned an error page`);
                // Still return it - let the parser provide a better error message
            }

            return response.arrayBuffer;
        } catch (error) {
            console.error(`[client] Failed to download file ${filePath}:`, error);
            throw new Error(`Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Download a file by path (alias for downloadNoteFile for API compatibility)
     */
    async downloadFile(path: string): Promise<ArrayBuffer> {
        return this.downloadNoteFile(path);
    }

    /**
     * Get a thumbnail image for a note
     * Note: The Supernote device doesn't provide thumbnails via its API
     * This would require downloading and parsing the .note file
     */
    async getThumbnail(_noteId: string): Promise<string | null> {
        // Thumbnails are not available from the device's HTTP API
        // Would need to download the .note file and extract the first page
        return null;
    }

    /**
     * @deprecated Use downloadNoteFile instead. PDF conversion is done locally.
     * This method is kept for API compatibility but throws an error.
     */
    async requestPdfConversion(_noteId: string): Promise<{ pdfUrl: string; pdfPath: string }> {
        throw new Error(
            'PDF conversion is not available from the Supernote device. ' +
            'Use the local PdfConverter class with supernote_pdf instead.'
        );
    }
}

/**
 * Mock API client for development/testing without a real Supernote device
 */
export class MockSupernoteAPIClient extends SupernoteAPIClient {
    private mockNotes: SupernoteFile[] = [
        {
            id: 'note-001',
            name: 'Meeting Notes',
            path: '/Note/Meeting Notes.note',
            size: 1024000,
            modifiedAt: new Date().toISOString(),
            createdAt: new Date(Date.now() - 86400000).toISOString(),
            pageCount: 5,
        },
        {
            id: 'note-002',
            name: 'Project Ideas',
            path: '/Note/Project Ideas.note',
            size: 2048000,
            modifiedAt: new Date(Date.now() - 3600000).toISOString(),
            createdAt: new Date(Date.now() - 172800000).toISOString(),
            pageCount: 12,
        },
        {
            id: 'note-003',
            name: 'Daily Journal',
            path: '/Note/Journal/Daily Journal.note',
            size: 512000,
            modifiedAt: new Date(Date.now() - 7200000).toISOString(),
            createdAt: new Date(Date.now() - 604800000).toISOString(),
            pageCount: 3,
        },
    ];

    constructor() {
        super('localhost', 8089);
    }

    async checkConnection(): Promise<ConnectionStatus> {
        return {
            connected: true,
            serverUrl: 'http://localhost:8089 (mock)',
            lastChecked: Date.now(),
        };
    }

    async validateConnection(): Promise<boolean> {
        return true;
    }

    async fetchNoteFiles(): Promise<{ data: SupernoteFile[] }> {
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 500));
        return { data: this.mockNotes };
    }

    async fetchNoteDetail(id: string): Promise<SupernoteFileDetail> {
        await new Promise(resolve => setTimeout(resolve, 200));
        const note = this.mockNotes.find(n => n.id === id);
        if (!note) {
            throw new Error(`Note ${id} not found`);
        }
        return { ...note };
    }

    async downloadNoteFile(_filePath: string): Promise<ArrayBuffer> {
        await new Promise(resolve => setTimeout(resolve, 500));
        // Return empty ArrayBuffer for mock
        return new ArrayBuffer(0);
    }

    async downloadFile(path: string): Promise<ArrayBuffer> {
        return this.downloadNoteFile(path);
    }

    async getThumbnail(_noteId: string): Promise<string | null> {
        return null;
    }
}
