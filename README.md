# ViewDaFile

A minimal dark-themed PDF viewer built with [Tauri 2](https://tauri.app) and [PDF.js](https://mozilla.github.io/pdf.js/). No framework, no bundler — just HTML/CSS/JS on the frontend and Rust on the backend.

## Features

- Open PDFs via button or drag-and-drop
- Keyboard navigation — `←` `→` `PgUp` `PgDn` `Home` `End`
- Scales to fit the window on resize
- Dark theme, no clutter

## Prerequisites

- [Rust](https://rustup.rs) (stable)
- [Tauri CLI v2](https://tauri.app/start/prerequisites/) — install once with:
  ```bash
  cargo install tauri-cli --version "^2" --locked
  ```
- [Node.js](https://nodejs.org) (only needed if you use `npm run` scripts; not required for plain `cargo tauri` commands)
- Windows: [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (ships with Windows 11; installer available for Windows 10)

## Getting started

```bash
# Dev mode (hot-reloads the UI on file save)
cargo tauri dev

# Production build
cargo tauri build
```

The compiled installer will be in `src-tauri/target/release/bundle/`.

## Icons

Placeholder icons are included. Replace them with your own by running:

```bash
cargo tauri icon path/to/icon.png
```
