# Application Icons

`icon.svg` is the editable master icon for MONBLAN. The platform-specific files
are generated from that SVG and referenced by Electron and electron-builder.

## Files

- `icon.svg` - Editable vector master
- `icon.png` - 1024x1024 transparent PNG for Linux and macOS Dock
- `icon.ico` - Multi-resolution Windows icon
- `icon.icns` - Multi-resolution macOS icon

Keep all generated files in sync when the master SVG changes.
