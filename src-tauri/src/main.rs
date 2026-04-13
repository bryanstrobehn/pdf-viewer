// Prevents an extra console window from appearing on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::command;

/// Opens a native file-picker filtered to PDFs and returns the chosen path.
#[command]
fn open_pdf_dialog(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .add_filter("PDF Files", &["pdf"])
        .blocking_pick_file()
        .map(|p| p.to_string())
}

/// Reads a file from disk and returns its raw bytes.
/// The JS side wraps these in a Uint8Array for PDF.js.
#[command]
fn read_pdf_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
}

/// Returns the file's last-modified time as a Unix timestamp (seconds).
#[command]
fn get_file_modified(path: String) -> Result<u64, String> {
    let meta     = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    let modified = meta.modified().map_err(|e| e.to_string())?;
    let secs     = modified
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    Ok(secs)
}

/// Opens an http/https URL in the default system browser.
/// Uses `cmd /C start` on Windows, which hands off to the OS shell.
#[command]
fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("Only http/https URLs are supported".to_string());
    }
    // The empty string "" is required as a window-title argument for `start`
    // so that it doesn't misinterpret the URL as the title.
    std::process::Command::new("cmd")
        .args(["/C", "start", "", &url])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![open_pdf_dialog, read_pdf_file, open_url, get_file_modified])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
