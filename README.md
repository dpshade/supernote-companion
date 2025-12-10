# Supernote Companion

Import Supernote `.note` files as PDFs into your Obsidian vault using the device's Browse & Access feature.

## Features

- **Wireless sync**: Connect to your Supernote over WiFi using Browse & Access mode
- **Batch import**: Import multiple notes at once with parallel downloads for speed
- **PDF conversion**: Convert `.note` files to PDF using the fast Rust-based CLI tool
- **Folder structure**: Optionally preserve your Supernote folder hierarchy
- **Duplicate detection**: Skip notes that have already been imported
- **Trash management**: Exclude specific notes from future syncs

## Requirements

- Supernote device with **Browse & Access** enabled (Settings → Browse & Access)
- Both devices on the same WiFi network
- **Desktop only** (Windows, macOS, Linux)

### PDF Converter

For reliable PDF conversion, install the `supernote_pdf` CLI tool:

```bash
# If you have Rust installed
cargo install supernote_pdf

# Or download from releases (coming soon)
```

The plugin will auto-detect the binary in common locations (`~/.cargo/bin`, `~/.local/bin`, `/usr/local/bin`).

A built-in TypeScript converter is available as a fallback but may have rendering issues with complex notes.

## Installation

### From Community Plugins (Recommended)

1. Open Obsidian Settings → Community plugins
2. Search for "Supernote Companion"
3. Click Install, then Enable

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release
2. Create folder: `<vault>/.obsidian/plugins/supernote-companion/`
3. Copy the files into the folder
4. Enable the plugin in Obsidian settings

## Usage

### Initial Setup

1. On your Supernote, enable **Browse & Access** (Settings → Browse & Access)
2. Note the IP address shown on the Supernote screen
3. In Obsidian, go to Settings → Supernote Companion
4. Enter the device IP address
5. Click "Test Connection" to verify

### Importing Notes

Use the command palette (Ctrl/Cmd + P) and search for:

- **Import new notes**: Download notes not yet in your vault
- **Bulk export all notes**: Re-import all notes (overwrites existing)
- **Check sync status**: See which notes are new, updated, or synced

### Commands

| Command | Description |
|---------|-------------|
| Import new notes | Import notes not yet in vault |
| Update existing notes | Re-sync previously imported notes |
| Bulk export all notes | Import/overwrite all notes |
| Check sync status | View sync overview |
| Manage trashed notes | Restore excluded notes |
| Test Supernote connection | Verify device connectivity |

## Settings

### Connection
- **Device IP**: Your Supernote's IP address (shown in Browse & Access)
- **Port**: Usually 8089 (default)
- **Timeout**: Connection timeout in seconds

### Import
- **Notes folder**: Where to save imported PDFs
- **Import mode**: PDF only, Markdown with PDF, or Markdown only
- **Preserve folder structure**: Mirror Supernote folder hierarchy
- **Filename template**: Customize output filenames

### Converter
- **CLI (recommended)**: Uses `supernote_pdf` Rust binary
- **Built-in**: TypeScript fallback (experimental)

## Troubleshooting

### Cannot connect to device

1. Ensure Browse & Access is enabled on Supernote
2. Verify both devices are on the same WiFi network
3. Check the IP address matches what's shown on Supernote
4. Try disabling VPN if active

### PDF conversion fails

1. Install `supernote_pdf` CLI tool (see Requirements)
2. Check plugin settings for converter path
3. Try the built-in converter as fallback

### Notes not appearing

1. Run "Check sync status" to see detected notes
2. Verify the notes folder path in settings
3. Check if notes were previously trashed

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- [supernote_pdf](https://github.com/philips/supernote-tool) - Rust library for parsing Supernote files
