use tauri_plugin_dialog;
use tauri_plugin_fs;

// Markly PDF — Tauri entry point.
// Batch 1: plain window shell. Native file access is done through the
// dialog + fs plugins so the app works fully offline with local files.
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running Markly PDF");
}
