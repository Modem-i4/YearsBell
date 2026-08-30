import { invoke } from "@tauri-apps/api/core";
import type { AppState } from "../types";

export async function loadState(): Promise<AppState> {
  return invoke<AppState>("load_state");
}

export async function persistState(state: AppState): Promise<AppState> {
  return invoke<AppState>("save_state", { state });
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
