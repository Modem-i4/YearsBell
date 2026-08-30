use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppState {
    pub version: u8,
    pub schedule: Vec<ScheduleEvent>,
    pub presets: Vec<SoundPreset>,
    pub audio_library: Vec<AudioFile>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            version: 1,
            schedule: Vec::new(),
            presets: Vec::new(),
            audio_library: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleEvent {
    pub id: Uuid,
    pub name: String,
    pub start_time: String,
    pub end_time: String,
    pub order: u32,
    pub preset_id: Option<Uuid>,
    pub custom_sounds: SoundSet,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundPreset {
    pub id: Uuid,
    pub name: String,
    pub sounds: SoundSet,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundSet {
    pub before3_min: Option<Uuid>,
    pub start: Option<Uuid>,
    pub end: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioFile {
    pub id: Uuid,
    pub display_name: String,
    pub stored_file_name: String,
    pub extension: String,
}
