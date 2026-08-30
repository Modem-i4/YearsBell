mod commands;
mod models;
mod state;
mod storage;
mod tray;

use state::SharedAppState;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let storage = storage::Storage::new(app.handle())?;
            let state = storage.load_or_create()?;
            app.manage(SharedAppState::new(state, storage));
            tray::setup_tray(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_state,
            commands::save_state
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Years Bell");
}
