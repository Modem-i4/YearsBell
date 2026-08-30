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

impl AppState {
    pub fn normalize(&mut self) {
        for event in &mut self.schedule {
            event.normalize_sound_mode();
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ScheduleSoundMode {
    Preset,
    None,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleEvent {
    pub id: Uuid,
    pub name: String,
    pub start_time: String,
    pub end_time: String,
    pub order: u32,
    #[serde(default = "default_schedule_sound_mode")]
    pub sound_mode: ScheduleSoundMode,
    pub preset_id: Option<Uuid>,
    #[serde(default = "SoundSet::empty")]
    pub custom_sounds: SoundSet,
}

impl ScheduleEvent {
    pub fn normalize_sound_mode(&mut self) {
        if self.sound_mode == ScheduleSoundMode::Preset && self.preset_id.is_none() {
            self.sound_mode = if self.custom_sounds.is_empty() {
                ScheduleSoundMode::None
            } else {
                ScheduleSoundMode::Custom
            };
        }

        match self.sound_mode {
            ScheduleSoundMode::Preset => {
                self.custom_sounds = SoundSet::empty();
            }
            ScheduleSoundMode::None => {
                self.preset_id = None;
                self.custom_sounds = SoundSet::empty();
            }
            ScheduleSoundMode::Custom => {
                self.preset_id = None;
            }
        }
    }
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

impl SoundSet {
    pub fn empty() -> Self {
        Self {
            before3_min: None,
            start: None,
            end: None,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.before3_min.is_none() && self.start.is_none() && self.end.is_none()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioFile {
    pub id: Uuid,
    pub display_name: String,
    pub stored_file_name: String,
    pub extension: String,
}

fn default_schedule_sound_mode() -> ScheduleSoundMode {
    ScheduleSoundMode::Preset
}
