import { invoke } from "@tauri-apps/api/core";
import type { AppState } from "../types";

export async function loadState(): Promise<AppState> {
  return invoke<AppState>("load_state");
}

export async function persistState(state: AppState): Promise<AppState> {
  return invoke<AppState>("save_state", { state });
}
