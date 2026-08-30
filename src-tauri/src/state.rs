use tokio::sync::RwLock;

use crate::{models::AppState, storage::Storage};

pub struct SharedAppState {
    current: RwLock<AppState>,
    storage: Storage,
}

impl SharedAppState {
    pub fn new(state: AppState, storage: Storage) -> Self {
        Self {
            current: RwLock::new(state),
            storage,
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
        Ok(state)
    }
}
