mod commands;
mod models;
mod state;
mod storage;
mod tray;

use state::SharedAppState;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let storage = storage::Storage::new(app.handle())?;
            let state = storage.load_or_create()?;
            app.manage(SharedAppState::new(state, storage));
            tray::setup_tray(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_state,
            commands::save_state,
            commands::import_audio_files,
            commands::rename_audio_file,
            commands::delete_audio_file
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Years Bell");
}
