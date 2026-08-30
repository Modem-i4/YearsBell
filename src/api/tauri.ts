import { invoke } from "@tauri-apps/api/core";
import type { AppState, SchedulerStatus } from "../types";

export async function loadState(): Promise<AppState> {
  return invoke<AppState>("load_state");
}

export async function persistState(state: AppState): Promise<AppState> {
  return invoke<AppState>("save_state", { state });
}

export async function loadSchedulerStatus(): Promise<SchedulerStatus> {
  return invoke<SchedulerStatus>("scheduler_status");
}

export async function importAudioFiles(paths: string[]): Promise<AppState> {
  return invoke<AppState>("import_audio_files", { paths });
}

export async function renameAudioFile(id: string, displayName: string): Promise<AppState> {
  return invoke<AppState>("rename_audio_file", { id, displayName });
}

export async function deleteAudioFile(id: string): Promise<AppState> {
  return invoke<AppState>("delete_audio_file", { id });
}

export async function playAudioFile(id: string): Promise<void> {
  return invoke<void>("play_audio_file", { id });
}

export async function stopAudioFile(): Promise<void> {
  return invoke<void>("stop_audio_file");
}

export async function exportConfig(path: string): Promise<void> {
  return invoke<void>("export_config", { path });
}

export async function importConfig(path: string): Promise<AppState> {
  return invoke<AppState>("import_config", { path });
}
