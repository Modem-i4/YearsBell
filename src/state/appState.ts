import { loadState, persistState } from "../api/tauri";
import type { AppState } from "../types";

export function createEmptyState(): AppState {
  return {
    version: 1,
    schedule: [],
    presets: [],
    audioLibrary: [],
  };
}

export async function loadInitialState(): Promise<AppState> {
  const state = await loadState();
  return normalizeState(state);
}

export async function saveState(state: AppState): Promise<AppState> {
  return persistState(normalizeState(state));
}

function normalizeState(state: AppState): AppState {
  return {
    version: 1,
    presets: state.presets ?? [],
    audioLibrary: state.audioLibrary ?? [],
    schedule: [...(state.schedule ?? [])]
      .sort((left, right) => left.order - right.order)
      .map((event, index) => ({
        ...event,
        order: index,
        customSounds: event.customSounds ?? {
          before3Min: null,
          start: null,
          end: null,
        },
      })),
  };
}
