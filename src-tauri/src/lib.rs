mod audio;
mod commands;
mod import_export;
mod models;
mod scheduler;
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
            let scheduler = scheduler::Scheduler::start(
                app.handle().clone(),
                state.clone(),
                storage.audio_dir(),
            );
            app.manage(SharedAppState::new(state, storage, scheduler));
            tray::setup_tray(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_state,
            commands::scheduler_status,
            commands::save_state,
            commands::import_audio_files,
            commands::rename_audio_file,
            commands::delete_audio_file,
            commands::play_audio_file,
            commands::stop_audio_file,
            commands::export_config,
            commands::import_config
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Years Bell");
}
