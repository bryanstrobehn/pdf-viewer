# ViewDaFile — Claude context

## Memory instruction
This file is the persistent memory for this project. All Claude sessions on all machines should read it at the start and update it when something worth remembering comes up — new features, decisions, deferred work, style preferences. Don't use the home-directory auto-memory system (~/.claude/...) for this project; put it here so it syncs via OneDrive and git.

---

## Project overview

**ViewDaFile** — a minimal Tauri v2 desktop PDF viewer for Windows. The guiding principle is to stay lean: no bloat, no speculative features.

**Stack:** Tauri v2 (Rust backend) + vanilla JS/HTML/CSS frontend + PDF.js 3.11.174 (CDN)

**Key files:**
- `src-tauri/src/main.rs` — Rust commands: `open_pdf_dialog`, `read_pdf_file`, `open_url`, `get_file_modified`, `get_launch_file`
- `ui/app.js` — all frontend logic
- `ui/index.html` — markup
- `ui/style.css` — dark theme, CSS variables
- `VDF/` — untracked directory, purpose unclear, don't touch

## Features shipped
- Continuous scroll rendering (all pages, sequential canvas render)
- Zoom: buttons, Ctrl+wheel, trackpad pinch, Ctrl+/-/0 shortcuts
- Text selection and hyperlinks (internal + external)
- Recent files (localStorage, 12 max, tiles on home screen)
- Drag and drop to open
- Open via double-click / Windows file association (argv[1] handled in Rust via `get_launch_file`)
- Ctrl+F find bar — highlights matching text layer spans, prev/next with Enter/Shift+Enter
- Page jump input — click the `3 / 47` display in the topbar, type a number, Enter to jump
- Easter egg — stick figure with deal-with-it glasses, home screen only, runs away 3x then shows a toast

---

## Deferred / TODO

### Remember scroll position per file
Attempted and reverted — wasn't working reliably. The save side (on close) was fine. The restore side (`scrollToPage` after `renderAllPages`) likely fires before the viewport finishes layout. To retry: try `requestAnimationFrame` or a short `setTimeout` before scrolling, or detect layout stability some other way.

---

## Collaboration style
- Keep responses terse. User can read the diff.
- Don't add features or improvements beyond what's asked.
- When suggesting enhancements, offer a short list and let the user pick — don't bundle them.
