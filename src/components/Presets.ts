import type { AppState, SoundPreset } from "../types";

type StateUpdate = AppState | ((current: AppState) => AppState);

interface PresetsOptions {
  root: Element | null;
  state: AppState;
  onChange: (state: StateUpdate, options?: { render?: boolean }) => void;
}

export function renderPresets({ root, state, onChange }: PresetsOptions) {
  if (!root) return;

  if (state.presets.length === 0) {
    root.innerHTML = `<p class="empty">Немає пресетів.</p>`;
    return;
  }

  root.innerHTML = `
    <div class="list">
      ${state.presets.map(renderPresetRow).join("")}
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
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-delete-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.deletePreset;
      onChange((current) => ({
        ...current,
        presets: current.presets.filter((preset) => preset.id !== id),
        schedule: current.schedule.map((event) =>
          event.presetId === id
            ? {
                ...event,
                presetId: null,
              }
            : event,
        ),
      }));
    });
  });
}

function renderPresetRow(preset: SoundPreset) {
  return `
    <article class="preset-row">
      <label>
        <span>Назва</span>
        <input data-preset-name="${preset.id}" value="${escapeHtml(preset.name)}" />
      </label>
      <div class="sound-placeholders">
        <label>
          <span>За 3 хв</span>
          <button class="sound-picker-preview" type="button">Не вибрано</button>
        </label>
        <label>
          <span>Початок</span>
          <button class="sound-picker-preview" type="button">Не вибрано</button>
        </label>
        <label>
          <span>Кінець</span>
          <button class="sound-picker-preview" type="button">Не вибрано</button>
        </label>
      </div>
      <button class="icon-button danger-button" type="button" data-delete-preset="${preset.id}" aria-label="Видалити пресет" title="Видалити">×</button>
    </article>
  `;
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
