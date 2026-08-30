use tauri::State;

use crate::{models::AppState, state::SharedAppState};

#[tauri::command]
pub async fn load_state(state: State<'_, SharedAppState>) -> Result<AppState, String> {
    Ok(state.get().await)
}

#[tauri::command]
pub async fn save_state(
    app_state: State<'_, SharedAppState>,
    state: AppState,
) -> Result<AppState, String> {
    validate_state(&state)?;
    app_state.replace(state).await
}

fn validate_state(state: &AppState) -> Result<(), String> {
    if state.version != 1 {
        return Err(format!("Unsupported app-state version: {}", state.version));
    }

    for event in &state.schedule {
        if event.start_time >= event.end_time {
            return Err(format!(
                "Invalid time interval for '{}': start must be earlier than end",
                event.name
            ));
        }
    }

    Ok(())
}
