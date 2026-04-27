// Prevents an extra console window from appearing on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::command;

/// Opens the Chromium print preview dialog via WebView2's COM API.
/// This is equivalent to window.print() but called from Rust, which gives us
/// a path to add more control later (e.g. direct-to-printer with settings).
#[cfg(target_os = "windows")]
fn do_webview2_print(
    controller: webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller,
) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_16, COREWEBVIEW2_PRINT_DIALOG_KIND_BROWSER,
    };
    use windows::core::Interface;

    let _ = unsafe {
        (|| -> windows::core::Result<()> {
            let webview = controller.CoreWebView2()?;
            let webview16: ICoreWebView2_16 = webview.cast()?;
            webview16.ShowPrintUI(COREWEBVIEW2_PRINT_DIALOG_KIND_BROWSER)?;
            Ok(())
        })()
    };
}

#[command]
fn print_pdf(webview_window: tauri::WebviewWindow) -> Result<(), String> {
    webview_window
        .with_webview(|wv| {
            #[cfg(target_os = "windows")]
            do_webview2_print(wv.controller());
        })
        .map_err(|e| e.to_string())
}

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

/// Returns the first CLI argument that looks like a PDF path (i.e. the file
/// Windows passes when the app is launched via double-click / file association).
#[command]
fn get_launch_file() -> Option<String> {
    std::env::args().nth(1).filter(|a| {
        let lower = a.to_lowercase();
        lower.ends_with(".pdf") && std::path::Path::new(a).is_file()
    })
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
        .invoke_handler(tauri::generate_handler![open_pdf_dialog, read_pdf_file, open_url, get_file_modified, get_launch_file, print_pdf])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
