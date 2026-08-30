use std::{collections::HashSet, path::PathBuf, sync::Arc, time::Duration};

use chrono::{Local, NaiveDate, NaiveTime, Timelike};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::{watch, RwLock};
use uuid::Uuid;

use crate::{
    audio,
    models::{AppState, AudioFile, ScheduleEvent, SoundSet},
};

const TICK_INTERVAL: Duration = Duration::from_millis(500);
const DUE_GRACE_SECONDS: i64 = 5;

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerStatus {
    pub next: Option<SchedulerBell>,
    pub last_fired: Option<SchedulerBell>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerBell {
    pub occurrence_id: String,
    pub event_id: Uuid,
    pub event_name: String,
    pub trigger: String,
    pub trigger_label: String,
    pub time: String,
    pub audio_id: Uuid,
    pub audio_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerError {
    pub message: String,
}

#[derive(Clone)]
pub struct Scheduler {
    state_tx: watch::Sender<AppState>,
    status: Arc<RwLock<SchedulerStatus>>,
}

impl Scheduler {
    pub fn start(app: AppHandle, initial_state: AppState, audio_dir: PathBuf) -> Self {
        let (state_tx, state_rx) = watch::channel(initial_state.clone());
        let status = Arc::new(RwLock::new(SchedulerStatus {
            next: next_bell(&initial_state, &audio_dir, Local::now()),
            last_fired: None,
            last_error: None,
        }));

        tauri::async_runtime::spawn(run_scheduler(app, audio_dir, state_rx, Arc::clone(&status)));

        Self { state_tx, status }
    }

    pub fn update(&self, state: AppState) {
        let _ = self.state_tx.send(state);
    }

    pub async fn status(&self) -> SchedulerStatus {
        self.status.read().await.clone()
    }
}

async fn run_scheduler(
    app: AppHandle,
    audio_dir: PathBuf,
    mut state_rx: watch::Receiver<AppState>,
    status: Arc<RwLock<SchedulerStatus>>,
) {
    let mut tick = tokio::time::interval(TICK_INTERVAL);
    let mut fired = HashSet::new();
    let mut current_date = Local::now().date_naive();
    let mut last_next_id: Option<String> = None;

    loop {
        tokio::select! {
            _ = tick.tick() => {
                let now = Local::now();
                if now.date_naive() != current_date {
                    current_date = now.date_naive();
                    fired.clear();
                    last_next_id = None;
                }

                let state = state_rx.borrow().clone();
                let evaluation = evaluate_schedule(&state, &audio_dir, now, &fired);

                for pending in evaluation.due {
                    fired.insert(pending.bell.occurrence_id.clone());
                    fire_bell(&app, &status, pending);
                }

                let next_id = evaluation.next.as_ref().map(|bell| bell.occurrence_id.clone());
                if next_id != last_next_id {
                    last_next_id = next_id;
                    publish_status(&app, &status, |snapshot| {
                        snapshot.next = evaluation.next.clone();
                        snapshot.last_error = None;
                    }).await;
                }
            }
            changed = state_rx.changed() => {
                if changed.is_err() {
                    break;
                }

                let now = Local::now();
                let state = state_rx.borrow().clone();
                let next = next_bell(&state, &audio_dir, now);
                last_next_id = next.as_ref().map(|bell| bell.occurrence_id.clone());
                publish_status(&app, &status, |snapshot| {
                    snapshot.next = next;
                    snapshot.last_error = None;
                }).await;
            }
        }
    }
}

fn fire_bell(app: &AppHandle, status: &Arc<RwLock<SchedulerStatus>>, pending: PendingBell) {
    let bell = pending.bell.clone();
    let audio_bell = pending.bell;
    let path = pending.path.clone();
    let audio_app = app.clone();
    let event_app = app.clone();
    let event_status = Arc::clone(status);
    let audio_status = Arc::clone(status);

    tauri::async_runtime::spawn(async move {
        {
            let mut snapshot = event_status.write().await;
            snapshot.last_fired = Some(bell.clone());
            snapshot.last_error = None;
        }

        let _ = event_app.emit("bell-fired", bell.clone());
        let _ = event_app.emit("scheduler-status", event_status.read().await.clone());
    });

    if let Err(error) = std::thread::Builder::new()
        .name("years-bell-audio".to_string())
        .spawn(move || {
            if let Err(error) = audio::play_file_blocking(&path) {
                let message = format!("Не вдалося відтворити '{}': {error}", audio_bell.audio_name);
                let _ = audio_app.emit(
                    "scheduler-error",
                    SchedulerError {
                        message: message.clone(),
                    },
                );
                tauri::async_runtime::spawn(async move {
                    let snapshot = {
                        let mut snapshot = audio_status.write().await;
                        snapshot.last_error = Some(message);
                        snapshot.clone()
                    };
                    let _ = audio_app.emit("scheduler-status", snapshot);
                });
            }
        })
    {
        let _ = app.emit(
            "scheduler-error",
            SchedulerError {
                message: format!("Не вдалося запустити audio-потік: {error}"),
            },
        );
    }
}

async fn publish_status(
    app: &AppHandle,
    status: &Arc<RwLock<SchedulerStatus>>,
    update: impl FnOnce(&mut SchedulerStatus),
) {
    let snapshot = {
        let mut snapshot = status.write().await;
        update(&mut snapshot);
        snapshot.clone()
    };

    let _ = app.emit("scheduler-status", snapshot);
}

struct ScheduleEvaluation {
    due: Vec<PendingBell>,
    next: Option<SchedulerBell>,
}

#[derive(Clone)]
struct PendingBell {
    bell: SchedulerBell,
    path: PathBuf,
    trigger_second: i64,
}

fn evaluate_schedule(
    state: &AppState,
    audio_dir: &PathBuf,
    now: chrono::DateTime<Local>,
    fired: &HashSet<String>,
) -> ScheduleEvaluation {
    let now_second = i64::from(now.time().num_seconds_from_midnight());
    let pending = scheduled_bells(state, audio_dir, now.date_naive());
    let mut due = Vec::new();
    let mut next: Option<&PendingBell> = None;

    for bell in &pending {
        let delta = bell.trigger_second - now_second;

        if delta > 0 {
            if next.is_none_or(|current| bell.trigger_second < current.trigger_second) {
                next = Some(bell);
            }
            continue;
        }

        if delta >= -DUE_GRACE_SECONDS && !fired.contains(&bell.bell.occurrence_id) {
            due.push(bell.clone());
        }
    }

    ScheduleEvaluation {
        due,
        next: next.map(|pending| pending.bell.clone()),
    }
}

fn next_bell(
    state: &AppState,
    audio_dir: &PathBuf,
    now: chrono::DateTime<Local>,
) -> Option<SchedulerBell> {
    evaluate_schedule(state, audio_dir, now, &HashSet::new()).next
}

fn scheduled_bells(state: &AppState, audio_dir: &PathBuf, date: NaiveDate) -> Vec<PendingBell> {
    let mut bells = Vec::new();

    for event in &state.schedule {
        let Some(start_time) = parse_time(&event.start_time) else {
            continue;
        };
        let Some(end_time) = parse_time(&event.end_time) else {
            continue;
        };

        if start_time >= end_time {
            continue;
        }

        let sounds = event_sounds(state, event);
        let start_second = i64::from(start_time.num_seconds_from_midnight());
        let end_second = i64::from(end_time.num_seconds_from_midnight());

        push_pending_bell(
            &mut bells,
            state,
            audio_dir,
            date,
            event,
            sounds.before3_min,
            "before3Min",
            "За 3 хв",
            start_second - 180,
        );
        push_pending_bell(
            &mut bells,
            state,
            audio_dir,
            date,
            event,
            sounds.start,
            "start",
            "Початок",
            start_second,
        );
        push_pending_bell(
            &mut bells,
            state,
            audio_dir,
            date,
            event,
            sounds.end,
            "end",
            "Кінець",
            end_second,
        );
    }

    bells
}

#[allow(clippy::too_many_arguments)]
fn push_pending_bell(
    bells: &mut Vec<PendingBell>,
    state: &AppState,
    audio_dir: &PathBuf,
    date: NaiveDate,
    event: &ScheduleEvent,
    audio_id: Option<Uuid>,
    trigger: &str,
    trigger_label: &str,
    trigger_second: i64,
) {
    if trigger_second < 0 {
        return;
    }

    let Some(audio_id) = audio_id else {
        return;
    };
    let Some(audio) = state
        .audio_library
        .iter()
        .find(|audio| audio.id == audio_id)
    else {
        return;
    };

    let time = seconds_to_time(trigger_second);

    bells.push(PendingBell {
        bell: SchedulerBell {
            occurrence_id: format!("{}:{}:{}", date.format("%Y-%m-%d"), event.id, trigger),
            event_id: event.id,
            event_name: event.name.clone(),
            trigger: trigger.to_string(),
            trigger_label: trigger_label.to_string(),
            time,
            audio_id,
            audio_name: audio.display_name.clone(),
        },
        path: audio_file_path(audio_dir, audio),
        trigger_second,
    });
}

fn event_sounds<'a>(state: &'a AppState, event: &'a ScheduleEvent) -> &'a SoundSet {
    event
        .preset_id
        .and_then(|preset_id| state.presets.iter().find(|preset| preset.id == preset_id))
        .map(|preset| &preset.sounds)
        .unwrap_or(&event.custom_sounds)
}

fn parse_time(value: &str) -> Option<NaiveTime> {
    NaiveTime::parse_from_str(value, "%H:%M").ok()
}

fn seconds_to_time(seconds: i64) -> String {
    let hours = seconds / 3600;
    let minutes = (seconds % 3600) / 60;

    format!("{hours:02}:{minutes:02}")
}

fn audio_file_path(audio_dir: &PathBuf, audio: &AudioFile) -> PathBuf {
    audio_dir.join(&audio.stored_file_name)
}
