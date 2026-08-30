import type { AppState, SoundPreset } from "../types";
import { confirm } from "@tauri-apps/plugin-dialog";
import { openSoundPicker, renderSoundPickerButton } from "./SoundPicker";

type StateUpdate = AppState | ((current: AppState) => AppState);

interface PresetsOptions {
  root: Element | null;
  state: AppState;
  getState: () => AppState;
  onChange: (state: StateUpdate, options?: { render?: boolean }) => void;
  onImportAudio: (paths: string[], options?: { render?: boolean }) => Promise<void>;
  onRenameAudio: (id: string, displayName: string, options?: { render?: boolean }) => Promise<void>;
  onDeleteAudio: (id: string, options?: { render?: boolean }) => Promise<void>;
  onPreviewAudio: (id: string) => Promise<void>;
  onStopPreviewAudio: () => Promise<void>;
}

export function renderPresets({
  root,
  state,
  getState,
  onChange,
  onImportAudio,
  onRenameAudio,
  onDeleteAudio,
  onPreviewAudio,
  onStopPreviewAudio,
}: PresetsOptions) {
  if (!root) return;

  if (state.presets.length === 0) {
    root.innerHTML = `<p class="empty">Немає пресетів.</p>`;
    return;
  }

  root.innerHTML = `
    <div class="list">
      ${state.presets.map((preset) => renderPresetRow(preset, state)).join("")}
    </div>
  `;

  root.querySelectorAll<HTMLInputElement>("[data-preset-name]").forEach((input) => {
    input.addEventListener("input", () => {
      const id = input.dataset.presetName;
      onChange(
        (current) => ({
          ...current,
          presets: current.presets.map((preset) => (preset.id === id ? { ...preset, name: input.value } : preset)),
        }),
        { render: false },
      );

      syncSchedulePresetName(id, input.value);
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-preset-sound]").forEach((button) => {
    button.addEventListener("click", () => {
      const presetId = button.dataset.presetId;
      const trigger = button.dataset.presetSound as "before3Min" | "start" | "end";
      const preset = state.presets.find((item) => item.id === presetId);

      if (!preset) return;

      openSoundPicker({
        value: preset.sounds[trigger],
        getState,
        onImport: onImportAudio,
        onRename: onRenameAudio,
        onDelete: onDeleteAudio,
        onPreview: onPreviewAudio,
        onStopPreview: onStopPreviewAudio,
        onSelect: (audioId) => {
          onChange((current) => ({
            ...current,
            presets: current.presets.map((item) =>
              item.id === presetId
                ? {
                    ...item,
                    sounds: {
                      ...item.sounds,
                      [trigger]: audioId,
                    },
                  }
                : item,
            ),
          }));
        },
      });
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-delete-preset]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.deletePreset;
      const preset = state.presets.find((item) => item.id === id);

      if (!preset) return;

      const isUsed = state.schedule.some((event) => event.soundMode === "preset" && event.presetId === id);

      if (isUsed) {
        const confirmed = await confirm(
          "Цей пресет використовується в розкладі. Видалити його і перенести поточні звуки в події?",
          {
            title: "Видалити пресет",
            kind: "warning",
            okLabel: "Видалити",
            cancelLabel: "Скасувати",
          },
        );

        if (!confirmed) {
          return;
        }
      }

      onChange((current) => ({
        ...current,
        presets: current.presets.filter((item) => item.id !== id),
        schedule: current.schedule.map((event) =>
          event.presetId === id
            ? {
                ...event,
                soundMode: "custom",
                presetId: null,
                customSounds: { ...preset.sounds },
              }
            : event,
        ),
      }));
    });
  });
}

function renderPresetRow(preset: SoundPreset, state: AppState) {
  return `
    <article class="preset-row">
      <label>
        <span>Назва</span>
        <input data-preset-name="${preset.id}" value="${escapeHtml(preset.name)}" />
      </label>
      <div class="sound-placeholders">
        <label>
          <span>За 3 хв</span>
          ${renderPresetSoundPicker(preset, "before3Min", state)}
        </label>
        <label>
          <span>Початок</span>
          ${renderPresetSoundPicker(preset, "start", state)}
        </label>
        <label>
          <span>Кінець</span>
          ${renderPresetSoundPicker(preset, "end", state)}
        </label>
      </div>
      <button class="icon-button danger-button" type="button" data-delete-preset="${preset.id}" aria-label="Видалити пресет" title="Видалити">×</button>
    </article>
  `;
}

function renderPresetSoundPicker(preset: SoundPreset, trigger: "before3Min" | "start" | "end", state: AppState) {
  const markup = renderSoundPickerButton(preset.sounds[trigger], state.audioLibrary);
  return markup.replace(
    "data-sound-picker",
    `data-sound-picker data-preset-id="${preset.id}" data-preset-sound="${trigger}"`,
  );
}

function syncSchedulePresetName(presetId: string | undefined, name: string) {
  if (!presetId) return;

  document.querySelectorAll<HTMLSelectElement>("[data-preset-select]").forEach((select) => {
    Array.from(select.options).forEach((option) => {
      if (option.value === presetId) {
        option.textContent = name;
      }
    });
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}
