export type TriggerType = "before3Min" | "start" | "end";

export interface SoundSet {
  before3Min: string | null;
  start: string | null;
  end: string | null;
}

export interface AudioFile {
  id: string;
  displayName: string;
  storedFileName: string;
  extension: string;
}

export interface SoundPreset {
  id: string;
  name: string;
  sounds: SoundSet;
}

export interface ScheduleEvent {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  order: number;
  presetId: string | null;
  customSounds: SoundSet;
}

export interface AppState {
  version: 1;
  schedule: ScheduleEvent[];
  presets: SoundPreset[];
  audioLibrary: AudioFile[];
}
