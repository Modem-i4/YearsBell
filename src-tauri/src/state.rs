use std::{path::Path, sync::Mutex};

use tokio::sync::RwLock;

use crate::{audio::AudioPreview, models::AppState, scheduler::Scheduler, storage::Storage};

pub struct SharedAppState {
    current: RwLock<AppState>,
    storage: Storage,
    scheduler: Scheduler,
    audio_preview: Mutex<Option<AudioPreview>>,
}

impl SharedAppState {
    pub fn new(state: AppState, storage: Storage, scheduler: Scheduler) -> Self {
        Self {
            current: RwLock::new(state),
            storage,
            scheduler,
            audio_preview: Mutex::new(None),
        }
    }

    pub async fn get(&self) -> AppState {
        self.current.read().await.clone()
    }

    pub async fn replace(&self, state: AppState) -> Result<AppState, String> {
        self.storage
            .save(&state)
            .map_err(|error| error.to_string())?;
        *self.current.write().await = state.clone();
        self.scheduler.update(state.clone());
        Ok(state)
    }

    pub fn storage(&self) -> &Storage {
        &self.storage
    }

    pub fn scheduler(&self) -> &Scheduler {
        &self.scheduler
    }

    pub fn start_audio_preview(&self, path: &Path) -> Result<(), String> {
        let mut audio_preview = self
            .audio_preview
            .lock()
            .map_err(|_| "Не вдалося отримати доступ до preview audio".to_string())?;

        if let Some(preview) = audio_preview.take() {
            preview.stop();
        }

        *audio_preview = Some(AudioPreview::start(path).map_err(|error| error.to_string())?);

        Ok(())
    }

    pub fn stop_audio_preview(&self) -> Result<(), String> {
        let mut audio_preview = self
            .audio_preview
            .lock()
            .map_err(|_| "Не вдалося отримати доступ до preview audio".to_string())?;

        if let Some(preview) = audio_preview.take() {
            preview.stop();
        }

        Ok(())
    }
}
