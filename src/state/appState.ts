import { loadState, persistState } from "../api/tauri";
import type { AppState, ScheduleEvent, ScheduleSoundMode, SoundSet } from "../types";

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
        ...normalizeScheduleEvent(event),
      })),
  };
}

function normalizeScheduleEvent(event: ScheduleEvent): { soundMode: ScheduleSoundMode; presetId: string | null; customSounds: SoundSet } {
  const customSounds = event.customSounds ?? createEmptySoundSet();
  let soundMode = event.soundMode;

  if (!soundMode) {
    soundMode = event.presetId ? "preset" : soundSetIsEmpty(customSounds) ? "none" : "custom";
  }

  if (soundMode === "none") {
    return {
      soundMode,
      presetId: null,
      customSounds: createEmptySoundSet(),
    };
  }

  if (soundMode === "custom") {
    return {
      soundMode,
      presetId: null,
      customSounds,
    };
  }

  if (!event.presetId) {
    return {
      soundMode: soundSetIsEmpty(customSounds) ? "none" : "custom",
      presetId: null,
      customSounds,
    };
  }

  return {
    soundMode,
    presetId: event.presetId,
    customSounds: createEmptySoundSet(),
  };
}

function createEmptySoundSet(): SoundSet {
  return {
    before3Min: null,
    start: null,
    end: null,
  };
}

function soundSetIsEmpty(sounds: SoundSet) {
  return !sounds.before3Min && !sounds.start && !sounds.end;
}
