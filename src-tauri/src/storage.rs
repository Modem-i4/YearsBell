use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use tauri::{AppHandle, Manager};

use crate::models::AppState;

pub struct Storage {
    state_path: PathBuf,
    audio_dir: PathBuf,
}

impl Storage {
    pub fn new(app: &AppHandle) -> Result<Self> {
        let app_dir = app
            .path()
            .app_data_dir()
            .context("unable to resolve app data directory")?;
        let audio_dir = app_dir.join("audio");

        fs::create_dir_all(&audio_dir).with_context(|| {
            format!(
                "unable to create app data directory at {}",
                app_dir.display()
            )
        })?;

        Ok(Self {
            state_path: app_dir.join("app-state.json"),
            audio_dir,
        })
    }

    pub fn load_or_create(&self) -> Result<AppState> {
        if !self.state_path.exists() {
            let state = AppState::default();
            self.save(&state)?;
            return Ok(state);
        }

        let raw = fs::read_to_string(&self.state_path)
            .with_context(|| format!("unable to read {}", self.state_path.display()))?;
        let state = serde_json::from_str::<AppState>(&raw)
            .with_context(|| format!("unable to parse {}", self.state_path.display()))?;

        Ok(state)
    }

    pub fn save(&self, state: &AppState) -> Result<()> {
        if let Some(parent) = self.state_path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("unable to create {}", parent.display()))?;
        }

        fs::create_dir_all(&self.audio_dir)
            .with_context(|| format!("unable to create {}", self.audio_dir.display()))?;

        let temp_path = temp_path_for(&self.state_path);
        let content = serde_json::to_vec_pretty(state).context("unable to serialize app state")?;

        fs::write(&temp_path, content)
            .with_context(|| format!("unable to write {}", temp_path.display()))?;
        fs::rename(&temp_path, &self.state_path).with_context(|| {
            format!(
                "unable to replace {} with {}",
                self.state_path.display(),
                temp_path.display()
            )
        })?;

        Ok(())
    }

    pub fn copy_audio_file(&self, source: &Path, stored_file_name: &str) -> Result<()> {
        fs::create_dir_all(&self.audio_dir)
            .with_context(|| format!("unable to create {}", self.audio_dir.display()))?;

        let destination = self.audio_dir.join(stored_file_name);
        fs::copy(source, &destination).with_context(|| {
            format!(
                "unable to copy audio file from {} to {}",
                source.display(),
                destination.display()
            )
        })?;

        Ok(())
    }

    pub fn delete_audio_file(&self, stored_file_name: &str) -> Result<()> {
        let path = self.audio_dir.join(stored_file_name);

        if path.exists() {
            fs::remove_file(&path)
                .with_context(|| format!("unable to delete audio file {}", path.display()))?;
        }

        Ok(())
    }

    pub fn audio_dir(&self) -> PathBuf {
        self.audio_dir.clone()
    }
}

fn temp_path_for(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("app-state.json");
    path.with_file_name(format!("{file_name}.tmp"))
}
