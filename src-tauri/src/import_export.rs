use std::{
    collections::{HashMap, HashSet},
    fs::File,
    io::{Read, Write},
    path::{Path, PathBuf},
};

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

use crate::{
    models::{AppState, AudioFile, ScheduleEvent, ScheduleSoundMode, SoundPreset, SoundSet},
    storage::Storage,
};

const FORMAT: &str = "years-bell-config";
const PRESET_FORMAT: &str = "years-bell-presets";
const LEGACY_FORMAT: &str = "school-bell-presets";
const VERSION: u8 = 1;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigArchiveManifest {
    format: String,
    version: u8,
    #[serde(default)]
    schedule: Vec<ScheduleEvent>,
    presets: Vec<SoundPreset>,
    audio_library: Vec<ArchiveAudioFile>,
}

impl ConfigArchiveManifest {
    fn normalize(&mut self) {
        for event in &mut self.schedule {
            event.normalize_sound_mode();
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveAudioFile {
    id: Uuid,
    display_name: String,
    file: String,
}

pub fn export_config(state: &AppState, storage: &Storage, destination: &Path) -> Result<()> {
    let mut referenced_audio_ids = collect_archive_audio_ids(&state.presets, &state.schedule)
        .into_iter()
        .collect::<Vec<_>>();
    referenced_audio_ids.sort();
    let mut archive_audio = Vec::new();

    for audio_id in referenced_audio_ids {
        let audio = state
            .audio_library
            .iter()
            .find(|item| item.id == audio_id)
            .ok_or_else(|| anyhow!("Конфігурація посилається на відсутню композицію"))?;

        let source = storage.audio_dir().join(&audio.stored_file_name);
        if !source.exists() {
            bail!("Файл '{}' не знайдено", audio.display_name);
        }

        archive_audio.push(ArchiveAudioFile {
            id: audio.id,
            display_name: audio.display_name.clone(),
            file: format!("audio/{}", audio.stored_file_name),
        });
    }

    let manifest = ConfigArchiveManifest {
        format: FORMAT.to_string(),
        version: VERSION,
        schedule: state.schedule.clone(),
        presets: state.presets.clone(),
        audio_library: archive_audio,
    };

    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("unable to create {}", parent.display()))?;
    }

    let file = File::create(destination)
        .with_context(|| format!("Не вдалося створити ZIP {}", destination.display()))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    zip.start_file("manifest.json", options)
        .context("Не вдалося створити manifest.json у ZIP")?;
    let manifest_json =
        serde_json::to_vec_pretty(&manifest).context("Не вдалося серіалізувати manifest.json")?;
    zip.write_all(&manifest_json)
        .context("Не вдалося записати manifest.json у ZIP")?;

    for audio in &manifest.audio_library {
        zip.start_file(&audio.file, options)
            .with_context(|| format!("Не вдалося додати {} у ZIP", audio.file))?;
        let source = storage
            .audio_dir()
            .join(file_name_from_archive_path(&audio.file)?);
        let mut source_file = File::open(&source)
            .with_context(|| format!("Не вдалося прочитати {}", source.display()))?;
        std::io::copy(&mut source_file, &mut zip)
            .with_context(|| format!("Не вдалося записати {} у ZIP", audio.file))?;
    }

    zip.finish().context("Не вдалося завершити ZIP")?;

    Ok(())
}

pub fn import_config(state: &mut AppState, storage: &Storage, source: &Path) -> Result<()> {
    let file = File::open(source)
        .with_context(|| format!("Не вдалося відкрити ZIP {}", source.display()))?;
    let mut zip = ZipArchive::new(file).context("Некоректний ZIP-архів")?;
    let mut manifest = read_manifest(&mut zip)?;
    manifest.normalize();

    validate_manifest(&manifest)?;

    let mut referenced_audio_ids = collect_archive_audio_ids(&manifest.presets, &manifest.schedule)
        .into_iter()
        .collect::<Vec<_>>();
    referenced_audio_ids.sort();
    let manifest_audio_by_id = manifest
        .audio_library
        .iter()
        .map(|audio| (audio.id, audio))
        .collect::<HashMap<_, _>>();
    let mut imported_audio_by_hash = HashMap::new();
    let mut audio_id_map = HashMap::new();
    let mut imported_audio = Vec::new();
    let mut audio_files = Vec::new();

    for source_audio_id in referenced_audio_ids {
        let archive_audio = manifest_audio_by_id.get(&source_audio_id).ok_or_else(|| {
            anyhow!("manifest.json посилається на аудіо, якого немає в audioLibrary")
        })?;
        let extension = supported_archive_audio_extension(&archive_audio.file)?;
        let bytes = read_archive_file(&mut zip, &archive_audio.file)?;
        let hash = hash_bytes(&bytes);

        if let Some(existing_id) = imported_audio_by_hash.get(&hash) {
            audio_id_map.insert(source_audio_id, *existing_id);
            continue;
        }

        let target_id = archive_audio.id;
        let stored_file_name = format!("{target_id}.{extension}");

        imported_audio.push(AudioFile {
            id: target_id,
            display_name: sanitized_name(&archive_audio.display_name, "Аудіофайл"),
            stored_file_name: stored_file_name.clone(),
            extension,
        });
        audio_files.push((stored_file_name, bytes));
        imported_audio_by_hash.insert(hash, target_id);
        audio_id_map.insert(source_audio_id, target_id);
    }

    let preset_id_map = manifest
        .presets
        .iter()
        .map(|preset| (preset.id, preset.id))
        .collect::<HashMap<_, _>>();

    let imported_presets = manifest
        .presets
        .into_iter()
        .map(|preset| {
            Ok(SoundPreset {
                id: preset.id,
                name: sanitized_name(&preset.name, "Імпортований пресет"),
                sounds: remap_sound_set(&preset.sounds, &audio_id_map)?,
            })
        })
        .collect::<Result<Vec<_>>>()?;

    let mut schedule = manifest.schedule;
    let mut imported_schedule = Vec::new();

    schedule.sort_by_key(|event| event.order);

    for (index, event) in schedule.into_iter().enumerate() {
        imported_schedule.push(ScheduleEvent {
            id: event.id,
            name: sanitized_name(&event.name, "Імпортована подія"),
            start_time: event.start_time,
            end_time: event.end_time,
            order: index as u32,
            sound_mode: event.sound_mode,
            preset_id: remap_preset_id(event.preset_id, &preset_id_map)?,
            custom_sounds: remap_sound_set(&event.custom_sounds, &audio_id_map)?,
        });
    }

    let mut imported_state = AppState {
        version: VERSION,
        schedule: imported_schedule,
        presets: imported_presets,
        audio_library: imported_audio,
    };
    imported_state.normalize();

    storage
        .replace_audio_files(&audio_files)
        .map_err(|error| anyhow!(error))?;
    *state = imported_state;

    Ok(())
}

fn read_manifest<R: Read + std::io::Seek>(
    zip: &mut ZipArchive<R>,
) -> Result<ConfigArchiveManifest> {
    let mut raw = String::new();
    zip.by_name("manifest.json")
        .context("У ZIP немає manifest.json")?
        .read_to_string(&mut raw)
        .context("Не вдалося прочитати manifest.json")?;

    serde_json::from_str(&raw).context("Некоректний manifest.json")
}

fn validate_manifest(manifest: &ConfigArchiveManifest) -> Result<()> {
    if manifest.format != FORMAT
        && manifest.format != PRESET_FORMAT
        && manifest.format != LEGACY_FORMAT
    {
        bail!("Невідомий формат архіву конфігурації");
    }

    if manifest.version != VERSION {
        bail!("Непідтримувана версія архіву конфігурації");
    }

    let mut archive_audio_ids = HashSet::new();

    for audio in &manifest.audio_library {
        if !archive_audio_ids.insert(audio.id) {
            bail!("manifest.json містить дубльований audio ID");
        }

        supported_archive_audio_extension(&audio.file)?;
    }

    let referenced_audio_ids = collect_archive_audio_ids(&manifest.presets, &manifest.schedule);

    for audio_id in referenced_audio_ids {
        if !archive_audio_ids.contains(&audio_id) {
            bail!("manifest.json посилається на аудіо, якого немає в audioLibrary");
        }
    }

    let mut preset_ids = HashSet::new();

    for preset in &manifest.presets {
        if !preset_ids.insert(preset.id) {
            bail!("manifest.json містить дубльований preset ID");
        }
    }

    let mut event_ids = HashSet::new();

    for event in &manifest.schedule {
        if !event_ids.insert(event.id) {
            bail!("manifest.json містить дубльований event ID");
        }

        if event.start_time >= event.end_time {
            bail!("Некоректний часовий інтервал у події '{}'", event.name);
        }

        match event.sound_mode {
            ScheduleSoundMode::Preset => {
                let preset_id = event
                    .preset_id
                    .ok_or_else(|| anyhow!("Подія '{}' не має вибраного пресета", event.name))?;

                if !preset_ids.contains(&preset_id) {
                    bail!("Подія '{}' посилається на відсутній пресет", event.name);
                }
            }
            ScheduleSoundMode::None | ScheduleSoundMode::Custom => {}
        }
    }

    Ok(())
}

fn read_archive_file<R: Read + std::io::Seek>(
    zip: &mut ZipArchive<R>,
    path: &str,
) -> Result<Vec<u8>> {
    validate_archive_audio_path(path)?;

    let mut file = zip
        .by_name(path)
        .with_context(|| format!("У ZIP немає файла {path}"))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .with_context(|| format!("Не вдалося прочитати {path}"))?;

    Ok(bytes)
}

fn validate_archive_audio_path(path: &str) -> Result<()> {
    let parsed = PathBuf::from(path);

    if parsed.is_absolute()
        || parsed.components().any(|component| {
            matches!(
                component,
                std::path::Component::ParentDir | std::path::Component::Prefix(_)
            )
        })
        || !path.starts_with("audio/")
    {
        bail!("Некоректний шлях аудіофайла у manifest.json");
    }

    Ok(())
}

fn supported_archive_audio_extension(path: &str) -> Result<String> {
    validate_archive_audio_path(path)?;

    let extension = Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_lowercase())
        .ok_or_else(|| anyhow!("Аудіофайл у manifest.json не має розширення"))?;

    if matches!(extension.as_str(), "mp3" | "wav") {
        Ok(extension)
    } else {
        bail!("Підтримуються лише .mp3 та .wav файли");
    }
}

fn file_name_from_archive_path(path: &str) -> Result<&str> {
    validate_archive_audio_path(path)?;

    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| anyhow!("Некоректна назва аудіофайла у manifest.json"))
}

fn collect_preset_audio_ids(presets: &[SoundPreset]) -> HashSet<Uuid> {
    presets
        .iter()
        .flat_map(|preset| {
            [
                preset.sounds.before3_min,
                preset.sounds.start,
                preset.sounds.end,
            ]
        })
        .flatten()
        .collect()
}

fn collect_archive_audio_ids(presets: &[SoundPreset], schedule: &[ScheduleEvent]) -> HashSet<Uuid> {
    let mut audio_ids = collect_preset_audio_ids(presets);

    for event in schedule {
        if event.sound_mode == ScheduleSoundMode::Custom {
            audio_ids.extend(sound_set_audio_ids(&event.custom_sounds));
        }
    }

    audio_ids
}

fn sound_set_audio_ids(sounds: &SoundSet) -> impl Iterator<Item = Uuid> {
    [sounds.before3_min, sounds.start, sounds.end]
        .into_iter()
        .flatten()
}

fn hash_bytes(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn sanitized_name(value: &str, fallback: &str) -> String {
    let trimmed = value.trim();

    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn remap_sound_set(sounds: &SoundSet, audio_id_map: &HashMap<Uuid, Uuid>) -> Result<SoundSet> {
    Ok(SoundSet {
        before3_min: remap_sound_id(sounds.before3_min, audio_id_map)?,
        start: remap_sound_id(sounds.start, audio_id_map)?,
        end: remap_sound_id(sounds.end, audio_id_map)?,
    })
}

fn remap_sound_id(id: Option<Uuid>, audio_id_map: &HashMap<Uuid, Uuid>) -> Result<Option<Uuid>> {
    id.map(|source_id| {
        audio_id_map
            .get(&source_id)
            .copied()
            .ok_or_else(|| anyhow!("Конфігурація посилається на відсутню композицію"))
    })
    .transpose()
}

fn remap_preset_id(id: Option<Uuid>, preset_id_map: &HashMap<Uuid, Uuid>) -> Result<Option<Uuid>> {
    id.map(|source_id| {
        preset_id_map
            .get(&source_id)
            .copied()
            .ok_or_else(|| anyhow!("Подія посилається на відсутній пресет"))
    })
    .transpose()
}
