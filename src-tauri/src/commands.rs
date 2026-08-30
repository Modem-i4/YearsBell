use std::path::PathBuf;

use tauri::State;
use uuid::Uuid;

use crate::{
    models::{AppState, AudioFile, SoundSet},
    scheduler::SchedulerStatus,
    state::SharedAppState,
};

#[tauri::command]
pub async fn load_state(state: State<'_, SharedAppState>) -> Result<AppState, String> {
    Ok(state.get().await)
}

#[tauri::command]
pub async fn scheduler_status(
    app_state: State<'_, SharedAppState>,
) -> Result<SchedulerStatus, String> {
    Ok(app_state.scheduler().status().await)
}

#[tauri::command]
pub async fn save_state(
    app_state: State<'_, SharedAppState>,
    state: AppState,
) -> Result<AppState, String> {
    validate_state(&state)?;
    app_state.replace(state).await
}

#[tauri::command]
pub async fn import_audio_files(
    app_state: State<'_, SharedAppState>,
    paths: Vec<String>,
) -> Result<AppState, String> {
    let mut state = app_state.get().await;
    let mut imported = Vec::new();

    for path in paths {
        let source = PathBuf::from(path);
        let extension = supported_audio_extension(&source)?;
        let id = Uuid::new_v4();
        let stored_file_name = format!("{id}.{extension}");
        let display_name = source
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or("Аудіофайл")
            .trim()
            .to_string();

        app_state
            .storage()
            .copy_audio_file(&source, &stored_file_name)
            .map_err(|error| error.to_string())?;

        imported.push(AudioFile {
            id,
            display_name: if display_name.is_empty() {
                "Аудіофайл".to_string()
            } else {
                display_name
            },
            stored_file_name,
            extension,
        });
    }

    state.audio_library.extend(imported);
    validate_state(&state)?;
    app_state.replace(state).await
}

#[tauri::command]
pub async fn rename_audio_file(
    app_state: State<'_, SharedAppState>,
    id: Uuid,
    display_name: String,
) -> Result<AppState, String> {
    let name = display_name.trim();

    if name.is_empty() {
        return Err("Назва композиції не може бути порожньою".to_string());
    }

    let mut state = app_state.get().await;
    let audio = state
        .audio_library
        .iter_mut()
        .find(|audio| audio.id == id)
        .ok_or_else(|| "Композицію не знайдено".to_string())?;

    audio.display_name = name.to_string();
    app_state.replace(state).await
}

#[tauri::command]
pub async fn delete_audio_file(
    app_state: State<'_, SharedAppState>,
    id: Uuid,
) -> Result<AppState, String> {
    let mut state = app_state.get().await;

    if audio_is_used(&state, id) {
        return Err("Композиція використовується у пресетах або подіях".to_string());
    }

    let index = state
        .audio_library
        .iter()
        .position(|audio| audio.id == id)
        .ok_or_else(|| "Композицію не знайдено".to_string())?;
    let audio = state.audio_library.remove(index);

    app_state
        .storage()
        .delete_audio_file(&audio.stored_file_name)
        .map_err(|error| error.to_string())?;

    app_state.replace(state).await
}

#[tauri::command]
pub async fn play_audio_file(app_state: State<'_, SharedAppState>, id: Uuid) -> Result<(), String> {
    let state = app_state.get().await;
    let audio = state
        .audio_library
        .iter()
        .find(|audio| audio.id == id)
        .ok_or_else(|| "Композицію не знайдено".to_string())?;
    let path = app_state
        .storage()
        .audio_dir()
        .join(&audio.stored_file_name);

    if !path.exists() {
        return Err(format!("Файл '{}' не знайдено", audio.display_name));
    }

    app_state.start_audio_preview(&path)?;

    Ok(())
}

#[tauri::command]
pub async fn stop_audio_file(app_state: State<'_, SharedAppState>) -> Result<(), String> {
    app_state.stop_audio_preview()
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

        if let Some(preset_id) = event.preset_id {
            if !state.presets.iter().any(|preset| preset.id == preset_id) {
                return Err(format!(
                    "Подія '{}' посилається на відсутній пресет",
                    event.name
                ));
            }
        }

        validate_sound_references(state, &event.custom_sounds)?;
    }

    for preset in &state.presets {
        validate_sound_references(state, &preset.sounds)?;
    }

    Ok(())
}

fn supported_audio_extension(path: &PathBuf) -> Result<String, String> {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_lowercase())
        .ok_or_else(|| "Файл не має розширення".to_string())?;

    if matches!(extension.as_str(), "mp3" | "wav") {
        Ok(extension)
    } else {
        Err("Підтримуються лише .mp3 та .wav файли".to_string())
    }
}

fn validate_sound_references(state: &AppState, sounds: &SoundSet) -> Result<(), String> {
    for sound_id in [sounds.before3_min, sounds.start, sounds.end]
        .into_iter()
        .flatten()
    {
        if !state.audio_library.iter().any(|audio| audio.id == sound_id) {
            return Err("Знайдено посилання на відсутню композицію".to_string());
        }
    }

    Ok(())
}

fn audio_is_used(state: &AppState, id: Uuid) -> bool {
    state
        .presets
        .iter()
        .any(|preset| sound_set_contains(&preset.sounds, id))
        || state
            .schedule
            .iter()
            .any(|event| sound_set_contains(&event.custom_sounds, id))
}

fn sound_set_contains(sounds: &SoundSet, id: Uuid) -> bool {
    sounds.before3_min == Some(id) || sounds.start == Some(id) || sounds.end == Some(id)
}
