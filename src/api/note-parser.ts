/**
 * TypeScript port of supernote_pdf's .note file parser and PDF converter.
 * 
 * This allows converting .note files to PDF directly in the browser/Electron
 * without requiring an external binary.
 */

import * as pako from 'pako';

// Device dimensions
const A5X_WIDTH = 1404;
const A5X_HEIGHT = 1872;
const A5X2_WIDTH = 1920;
const A5X2_HEIGHT = 2560;

// Metadata regex pattern
const METADATA_RE = /<([^:]+?):([^>]*?)>/g;

// Valid Supernote file signature prefixes
// The signature is read from offset 4, so it doesn't include the first 4 bytes
const VALID_SIGNATURE_PREFIXES = [
    'noteSN_FILE_VER_',   // Older .note format (with 'note' prefix in signature area)
    'SN_FILE_VER_',       // Standard .note format (e.g., SN_FILE_VER_20230015)
    'SN_FILE_ASA_',       // Alternative format
];

// Minimum file size for a valid .note file (header + footer at minimum)
const MIN_NOTE_FILE_SIZE = 100;

interface Layer {
    key: string;
    protocol: string;
    bitmapAddress: number;
}

interface Page {
    addr: number;
    layers: Layer[];
}

interface Notebook {
    signature: string;
    pages: Page[];
    width: number;
    height: number;
}

/**
 * DataView wrapper for easier binary reading with bounds checking
 */
class BinaryReader {
    private view: DataView;
    private data: Uint8Array;
    private pos: number = 0;

    constructor(buffer: ArrayBuffer) {
        this.view = new DataView(buffer);
        this.data = new Uint8Array(buffer);
    }

    get length(): number {
        return this.data.length;
    }

    get position(): number {
        return this.pos;
    }

    /**
     * Check if reading `size` bytes from `pos` is within bounds
     */
    checkBounds(pos: number, size: number = 1): boolean {
        return pos >= 0 && pos + size <= this.data.length;
    }

    seek(pos: number): void {
        if (pos < 0 || pos > this.data.length) {
            throw new Error(`Seek out of bounds: pos=${pos}, fileLength=${this.data.length}`);
        }
        this.pos = pos;
    }

    seekEnd(offset: number): void {
        const newPos = this.data.length + offset;
        if (newPos < 0 || newPos > this.data.length) {
            throw new Error(`SeekEnd out of bounds: offset=${offset}, fileLength=${this.data.length}`);
        }
        this.pos = newPos;
    }

    readU32LE(): number {
        if (!this.checkBounds(this.pos, 4)) {
            throw new Error(`Read U32 out of bounds: pos=${this.pos}, fileLength=${this.data.length}`);
        }
        const val = this.view.getUint32(this.pos, true);
        this.pos += 4;
        return val;
    }

    readBytes(length: number): Uint8Array {
        if (length < 0) {
            throw new Error(`Invalid read length: ${length}`);
        }
        if (!this.checkBounds(this.pos, length)) {
            throw new Error(`Read bytes out of bounds: pos=${this.pos}, length=${length}, fileLength=${this.data.length}`);
        }
        const bytes = this.data.slice(this.pos, this.pos + length);
        this.pos += length;
        return bytes;
    }

    readString(length: number): string {
        const bytes = this.readBytes(length);
        return new TextDecoder().decode(bytes);
    }
}

/**
 * Validate that the file is a valid Supernote .note file
 */
function validateNoteFile(reader: BinaryReader): void {
    if (reader.length === 0) {
        throw new Error('File is empty (0 bytes) - download may have failed');
    }
    
    if (reader.length < MIN_NOTE_FILE_SIZE) {
        throw new Error(`File is too small (${reader.length} bytes) - may be corrupted or not a .note file`);
    }
    
    const signature = getSignature(reader);
    const isValid = VALID_SIGNATURE_PREFIXES.some(prefix => signature.startsWith(prefix));
    
    if (!isValid) {
        // Check if this might be HTML (common when download fails and returns error page)
        reader.seek(0);
        const firstBytes = new TextDecoder().decode(reader.readBytes(Math.min(50, reader.length)));
        
        if (firstBytes.toLowerCase().includes('<!doctype') || firstBytes.toLowerCase().includes('<html')) {
            throw new Error('Downloaded HTML instead of .note file - device may have returned an error page');
        }
        
        throw new Error(`Invalid .note file signature: "${signature.substring(0, 20)}" - file may not be a Supernote note`);
    }
}

/**
 * Parse a metadata block at a given address
 */
function parseMetadataBlock(reader: BinaryReader, address: number): Map<string, string> {
    if (address === 0) {
        return new Map();
    }

    // Validate address is within reasonable bounds (need at least 4 bytes for block length)
    if (address < 0 || address > reader.length - 4) {
        console.warn(`Invalid metadata address: ${address} (file length: ${reader.length})`);
        return new Map();
    }

    reader.seek(address);
    const blockLen = reader.readU32LE();
    
    // Validate block length is reasonable
    if (blockLen <= 0 || blockLen > reader.length - address - 4) {
        console.warn(`Invalid block length: ${blockLen} at address ${address} (file length: ${reader.length})`);
        return new Map();
    }

    const content = reader.readString(blockLen);

    const map = new Map<string, string>();
    let match;
    const re = new RegExp(METADATA_RE.source, 'g');
    while ((match = re.exec(content)) !== null) {
        map.set(match[1], match[2]);
    }

    return map;
}

/**
 * Get the file signature
 */
function getSignature(reader: BinaryReader): string {
    reader.seek(4);
    return reader.readString(20);
}

/**
 * Detect device dimensions from metadata
 */
function detectDeviceDimensions(
    reader: BinaryReader,
    footerMap: Map<string, string>
): [number, number] {
    const fileFeature = footerMap.get('FILE_FEATURE');
    if (fileFeature) {
        const headerAddr = parseInt(fileFeature, 10);
        if (!isNaN(headerAddr)) {
            const headerMap = parseMetadataBlock(reader, headerAddr);
            const equipment = headerMap.get('APPLY_EQUIPMENT');
            if (equipment === 'N5') {
                return [A5X2_WIDTH, A5X2_HEIGHT];
            }
        }
    }
    return [A5X_WIDTH, A5X_HEIGHT];
}

/**
 * Parse a .note file into a Notebook structure
 */
function parseNotebook(reader: BinaryReader): Notebook {
    const signature = getSignature(reader);

    // Get footer address (last 4 bytes of file)
    reader.seekEnd(-4);
    const footerAddr = reader.readU32LE();
    const footerMap = parseMetadataBlock(reader, footerAddr);

    // Detect dimensions
    const [width, height] = detectDeviceDimensions(reader, footerMap);

    // Get page addresses, sorted by page number
    const pageEntries: [number, number][] = [];
    footerMap.forEach((value, key) => {
        if (key.startsWith('PAGE')) {
            const pageNum = parseInt(key.slice(4), 10);
            const addr = parseInt(value, 10);
            if (!isNaN(pageNum) && !isNaN(addr)) {
                pageEntries.push([pageNum, addr]);
            }
        }
    });
    pageEntries.sort((a, b) => a[0] - b[0]);

    const pages: Page[] = [];
    for (const [, addr] of pageEntries) {
        const pageMap = parseMetadataBlock(reader, addr);
        
        // Get layer order
        const layerSeq = pageMap.get('LAYERSEQ');
        const layerOrder = layerSeq
            ? layerSeq.split(',')
            : ['BGLAYER', 'MAINLAYER', 'LAYER1', 'LAYER2', 'LAYER3'];

        const layers: Layer[] = [];
        for (const layerKey of layerOrder) {
            const layerAddrStr = pageMap.get(layerKey);
            if (layerAddrStr) {
                const layerAddr = parseInt(layerAddrStr, 10);
                const layerData = parseMetadataBlock(reader, layerAddr);
                layers.push({
                    key: layerKey,
                    protocol: layerData.get('LAYERPROTOCOL') || '',
                    bitmapAddress: parseInt(layerData.get('LAYERBITMAP') || '0', 10),
                });
            }
        }

        pages.push({ addr, layers });
    }

    return { signature, pages, width, height };
}

/**
 * Decode RATTA_RLE compressed data
 */
function decodeRLE(compressedData: Uint8Array, width: number, height: number): Uint8Array {
    const expectedLen = width * height;
    const decompressed: number[] = [];

    let i = 0;
    let holder: [number, number] | null = null;

    while (i < compressedData.length) {
        if (i + 1 >= compressedData.length) break;

        const colorCode = compressedData[i];
        const lengthCode = compressedData[i + 1];
        i += 2;

        let length: number;

        if (holder !== null) {
            const [prevColorCode, prevLengthCode] = holder;
            holder = null;

            if (colorCode === prevColorCode) {
                length = 1 + lengthCode + (((prevLengthCode & 0x7f) + 1) << 7);
            } else {
                const heldLength = ((prevLengthCode & 0x7f) + 1) << 7;
                for (let j = 0; j < heldLength; j++) {
                    decompressed.push(prevColorCode);
                }
                length = lengthCode + 1;
            }
        } else if (lengthCode === 0xff) {
            length = 0x4000; // 16384
        } else if ((lengthCode & 0x80) !== 0) {
            holder = [colorCode, lengthCode];
            continue;
        } else {
            length = lengthCode + 1;
        }

        for (let j = 0; j < length; j++) {
            decompressed.push(colorCode);
        }
    }

    // Handle remaining holder
    if (holder !== null) {
        const [colorCode, lengthCode] = holder;
        const remainingLen = expectedLen - decompressed.length;
        const tailLength = Math.min(((lengthCode & 0x7f) + 1) << 7, remainingLen);
        for (let j = 0; j < tailLength; j++) {
            decompressed.push(colorCode);
        }
    }

    // Pad or truncate to expected size
    while (decompressed.length < expectedLen) {
        decompressed.push(0x62); // Transparent
    }
    if (decompressed.length > expectedLen) {
        decompressed.length = expectedLen;
    }

    return new Uint8Array(decompressed);
}

/**
 * Convert a Supernote color code to RGBA
 */
function toRGBA(pixelByte: number): [number, number, number, number] {
    switch (pixelByte) {
        case 0x61: return [0, 0, 0, 255];       // Black
        case 0x65: return [255, 255, 255, 255]; // White
        case 0x62: return [0, 0, 0, 0];         // Transparent

        case 0x63:
        case 0x9d:
        case 0x9e:
            return [0x9d, 0x9d, 0x9d, 255];     // Dark Gray

        case 0x64:
        case 0xc9:
        case 0xca:
            return [0xc9, 0xc9, 0xc9, 255];     // Gray

        default:
            // Anti-aliasing: byte value is grayscale intensity
            return [pixelByte, pixelByte, pixelByte, 255];
    }
}

/**
 * Decode a PNG image to RGBA pixel data
 * Uses browser APIs available in Electron/Obsidian context
 */
async function decodePNG(pngData: Uint8Array, width: number, height: number): Promise<Uint8Array | null> {
    try {
        // Create a blob from the PNG data
        const blob = new Blob([pngData], { type: 'image/png' });
        const imageBitmap = await createImageBitmap(blob);
        
        // Create a canvas element to extract pixel data
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            console.warn('[note-parser] Could not get 2d context for PNG decoding');
            return null;
        }
        
        // Draw the image and extract pixels
        ctx.drawImage(imageBitmap, 0, 0, width, height);
        const imageData = ctx.getImageData(0, 0, width, height);
        
        return new Uint8Array(imageData.data.buffer);
    } catch (err) {
        console.warn('[note-parser] Failed to decode PNG layer:', err);
        return null;
    }
}

/**
 * Render a page to RGBA pixel data
 */
async function renderPage(
    reader: BinaryReader,
    page: Page,
    width: number,
    height: number
): Promise<Uint8Array> {
    // Start with white canvas
    const canvas = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
        canvas[i * 4 + 0] = 255; // R
        canvas[i * 4 + 1] = 255; // G
        canvas[i * 4 + 2] = 255; // B
        canvas[i * 4 + 3] = 255; // A
    }

    for (const layer of page.layers) {
        if (layer.bitmapAddress === 0) continue;

        reader.seek(layer.bitmapAddress);
        const blockLen = reader.readU32LE();
        const compressedData = reader.readBytes(blockLen);

        let layerPixels: Uint8Array | null = null;

        if (layer.protocol === 'RATTA_RLE') {
            layerPixels = decodeRLE(compressedData, width, height);
            
            // Composite RLE layer onto canvas with alpha blending
            for (let i = 0; i < width * height; i++) {
                const [r, g, b, a] = toRGBA(layerPixels[i]);
                if (a === 0) continue; // Skip transparent

                const idx = i * 4;
                if (a === 255) {
                    // Fully opaque - just overwrite
                    canvas[idx + 0] = r;
                    canvas[idx + 1] = g;
                    canvas[idx + 2] = b;
                    canvas[idx + 3] = 255;
                } else {
                    // Alpha blend
                    const alpha = a / 255;
                    const invAlpha = 1 - alpha;
                    canvas[idx + 0] = Math.round(r * alpha + canvas[idx + 0] * invAlpha);
                    canvas[idx + 1] = Math.round(g * alpha + canvas[idx + 1] * invAlpha);
                    canvas[idx + 2] = Math.round(b * alpha + canvas[idx + 2] * invAlpha);
                }
            }
        } else if (layer.protocol === 'PNG') {
            // Decode PNG layer
            layerPixels = await decodePNG(compressedData, width, height);
            
            if (layerPixels) {
                // PNG pixels are already in RGBA format, composite them
                for (let i = 0; i < width * height; i++) {
                    const idx = i * 4;
                    const a = layerPixels[idx + 3];
                    if (a === 0) continue; // Skip transparent
                    
                    const r = layerPixels[idx + 0];
                    const g = layerPixels[idx + 1];
                    const b = layerPixels[idx + 2];

                    if (a === 255) {
                        // Fully opaque - just overwrite
                        canvas[idx + 0] = r;
                        canvas[idx + 1] = g;
                        canvas[idx + 2] = b;
                        canvas[idx + 3] = 255;
                    } else {
                        // Alpha blend
                        const alpha = a / 255;
                        const invAlpha = 1 - alpha;
                        canvas[idx + 0] = Math.round(r * alpha + canvas[idx + 0] * invAlpha);
                        canvas[idx + 1] = Math.round(g * alpha + canvas[idx + 1] * invAlpha);
                        canvas[idx + 2] = Math.round(b * alpha + canvas[idx + 2] * invAlpha);
                    }
                }
            }
        } else {
            console.warn(`[note-parser] Unknown layer protocol: ${layer.protocol}`);
            continue;
        }
    }

    return canvas;
}

/**
 * Convert RGBA to RGB (drop alpha channel)
 */
function rgbaToRgb(rgba: Uint8Array, width: number, height: number): Uint8Array {
    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0; i < width * height; i++) {
        rgb[i * 3 + 0] = rgba[i * 4 + 0];
        rgb[i * 3 + 1] = rgba[i * 4 + 1];
        rgb[i * 3 + 2] = rgba[i * 4 + 2];
    }
    return rgb;
}

/**
 * Build a PDF from page images
 * 
 * Converts pixel dimensions to PDF points (72 points = 1 inch)
 * Supernote screens are approximately 226 DPI, so we scale accordingly
 * to produce a readable PDF at standard viewing sizes.
 */
function buildPDF(pageImages: Uint8Array[], width: number, height: number): Uint8Array {
    const chunks: Uint8Array[] = [];
    const xrefOffsets: number[] = [];
    let byteOffset = 0;

    const encoder = new TextEncoder();

    function write(data: Uint8Array | string): void {
        const bytes = typeof data === 'string' ? encoder.encode(data) : data;
        chunks.push(bytes);
        byteOffset += bytes.length;
    }

    // Convert pixel dimensions to PDF points
    // Use 150 DPI for good balance of quality and file size
    // PDF points = pixels * 72 / DPI
    const DPI = 150;
    const pdfWidth = Math.round(width * 72 / DPI);
    const pdfHeight = Math.round(height * 72 / DPI);

    // PDF Header
    write('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n');

    // Object 1: Catalog
    xrefOffsets.push(byteOffset);
    write('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

    // Object 2: Pages
    xrefOffsets.push(byteOffset);
    const pageRefs = pageImages.map((_, i) => `${(i * 3) + 3} 0 R`).join(' ');
    write(`2 0 obj\n<< /Type /Pages /Kids [ ${pageRefs} ] /Count ${pageImages.length} >>\nendobj\n`);

    // Page objects
    for (let i = 0; i < pageImages.length; i++) {
        const pageObjId = (i * 3) + 3;
        const contentsObjId = (i * 3) + 4;
        const imageObjId = (i * 3) + 5;

        // Compress image data
        const compressedPixels = pako.deflate(pageImages[i]);

        // Page object with correct dimensions
        xrefOffsets.push(byteOffset);
        write(`${pageObjId} 0 obj\n<< /Type /Page\n   /Parent 2 0 R\n   /MediaBox [0 0 ${pdfWidth} ${pdfHeight}]\n   /Contents ${contentsObjId} 0 R\n   /Resources << /XObject << /Im1 ${imageObjId} 0 R >> >>\n>>\nendobj\n`);

        // Contents object - transformation matrix scales image to fill page
        const contents = `q\n${pdfWidth} 0 0 ${pdfHeight} 0 0 cm\n/Im1 Do\nQ\n`;
        xrefOffsets.push(byteOffset);
        write(`${contentsObjId} 0 obj\n<< /Length ${contents.length} >>\nstream\n${contents}\nendstream\nendobj\n`);

        // Image object
        xrefOffsets.push(byteOffset);
        write(`${imageObjId} 0 obj\n<< /Type /XObject\n   /Subtype /Image\n   /Width ${width}\n   /Height ${height}\n   /ColorSpace /DeviceRGB\n   /BitsPerComponent 8\n   /Filter /FlateDecode\n   /Length ${compressedPixels.length} >>\nstream\n`);
        write(compressedPixels);
        write('\nendstream\nendobj\n');
    }

    // Cross-reference table
    const xrefStart = byteOffset;
    write('xref\n');
    write(`0 ${xrefOffsets.length + 1}\n`);
    write('0000000000 65535 f \n');
    for (const offset of xrefOffsets) {
        write(`${offset.toString().padStart(10, '0')} 00000 n \n`);
    }

    // Trailer
    write('trailer\n');
    write(`<< /Size ${xrefOffsets.length + 1} /Root 1 0 R >>\n`);
    write('startxref\n');
    write(`${xrefStart}\n`);
    write('%%EOF\n');

    // Combine all chunks
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }

    return result;
}

/**
 * Convert a .note file to PDF
 * @param noteData Raw .note file data
 * @returns PDF file data as ArrayBuffer
 */
export async function convertNoteToPdf(noteData: ArrayBuffer): Promise<ArrayBuffer> {
    // Diagnostic logging
    console.debug(`[note-parser] Converting .note file: ${noteData.byteLength} bytes`);

    const reader = new BinaryReader(noteData);

    // Validate file before parsing
    validateNoteFile(reader);

    const notebook = parseNotebook(reader);
    console.debug(`[note-parser] Parsed notebook: ${notebook.pages.length} pages, ${notebook.width}x${notebook.height}`);

    const pageImages: Uint8Array[] = [];

    for (let i = 0; i < notebook.pages.length; i++) {
        const page = notebook.pages[i];
        try {
            console.debug(`[note-parser] Rendering page ${i + 1}/${notebook.pages.length}, layers: ${page.layers.map(l => l.protocol).join(', ')}`);
            const rgba = await renderPage(reader, page, notebook.width, notebook.height);
            const rgb = rgbaToRgb(rgba, notebook.width, notebook.height);
            pageImages.push(rgb);
        } catch (err) {
            console.error(`[note-parser] Failed to render page ${i + 1}:`, err);
            throw new Error(`Failed to render page ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    const pdfBytes = buildPDF(pageImages, notebook.width, notebook.height);
    console.debug(`[note-parser] Generated PDF: ${pdfBytes.length} bytes`);
    return pdfBytes.buffer;
}

/**
 * Get information about a .note file without full conversion
 */
export function getNoteInfo(noteData: ArrayBuffer): { 
    signature: string; 
    pageCount: number; 
    width: number; 
    height: number;
} {
    const reader = new BinaryReader(noteData);
    
    // Validate file before parsing
    validateNoteFile(reader);
    
    const notebook = parseNotebook(reader);
    return {
        signature: notebook.signature,
        pageCount: notebook.pages.length,
        width: notebook.width,
        height: notebook.height,
    };
}
