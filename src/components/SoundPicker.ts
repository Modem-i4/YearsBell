import { getCurrentWebview } from "@tauri-apps/api/webview";
import { openUrl } from "@tauri-apps/plugin-opener";
import { open } from "@tauri-apps/plugin-dialog";
import type { AppState, AudioFile } from "../types";

interface SoundPickerOptions {
  value: string | null;
  getState: () => AppState;
  onSelect: (audioId: string | null) => void;
  onImport: (paths: string[], options?: { render?: boolean }) => Promise<void>;
  onRename: (id: string, displayName: string, options?: { render?: boolean }) => Promise<void>;
  onDelete: (id: string, options?: { render?: boolean }) => Promise<void>;
}

export function renderSoundPickerButton(value: string | null, audioLibrary: AudioFile[]) {
  const audio = value ? audioLibrary.find((item) => item.id === value) : null;
  const text = audio ? audio.displayName : "Не вибрано";
  const modifier = audio ? "has-sound" : "";

  return `<button class="sound-picker-preview ${modifier}" type="button" data-sound-picker>${escapeHtml(text)}</button>`;
}

export function openSoundPicker({ value, getState, onSelect, onImport, onRename, onDelete }: SoundPickerOptions) {
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  let selectedValue = value;
  let isDraggingFiles = false;
  let closed = false;
  let unlistenDrop: (() => void) | null = null;

  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", closeOnEscape);
    unlistenDrop?.();
    overlay.remove();
  };

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      close();
    }
  });

  document.addEventListener("keydown", closeOnEscape);
  document.body.append(overlay);
  render();
  void bindNativeDrop();

  function render() {
    const state = getState();

    overlay.innerHTML = `
      <section class="modal sound-picker-modal" role="dialog" aria-modal="true" aria-labelledby="sound-picker-title">
        <div class="modal-heading">
          <h3 id="sound-picker-title">Вибір звуку</h3>
          <button class="icon-button danger-button" type="button" data-close-picker aria-label="Закрити" title="Закрити">×</button>
        </div>
        <button class="modal-drop-zone ${isDraggingFiles ? "drag-active" : ""}" type="button" data-import-audio>
          <strong>Додати звук</strong>
          <span>Перетягніть .mp3/.wav сюди або натисніть</span>
        </button>
        <p class="sound-picker-help">
          Треба&nbsp;<a href="https://mp3cut.net/" data-open-trimmer>обрізати композицію</a>?
        </p>
        <div class="sound-choice-list">
          <button class="sound-choice ${selectedValue === null ? "selected" : ""}" type="button" data-sound-choice="none">
            <span>Без звуку</span>
            <small>Цей сигнал не буде відтворюватися</small>
          </button>
          <div class="modal-audio-list">
            ${
              state.audioLibrary.length === 0
                ? `<p class="empty compact-empty">Бібліотека порожня.</p>`
                : state.audioLibrary.map((audio) => renderAudioRow(audio, selectedValue)).join("")
            }
          </div>
        </div>
      </section>
    `;

    overlay.querySelector("[data-close-picker]")?.addEventListener("click", close);
    overlay.querySelector("[data-import-audio]")?.addEventListener("click", pickFiles);
    overlay.querySelector<HTMLAnchorElement>("[data-open-trimmer]")?.addEventListener("click", async (event) => {
      event.preventDefault();
      await openUrl("https://mp3cut.net/");
    });
    overlay.querySelector("[data-sound-choice]")?.addEventListener("click", () => {
      selectedValue = null;
      onSelect(null);
      close();
    });

    overlay.querySelectorAll<HTMLElement>("[data-audio-row]").forEach((row) => {
      row.addEventListener("click", (event) => {
        if ((event.target as HTMLElement).closest("input, button, label, a")) {
          return;
        }

        selectAudio(row.dataset.audioRow ?? null);
      });

      row.addEventListener("keydown", (event) => {
        if (event.target !== row || (event.key !== "Enter" && event.key !== " ")) {
          return;
        }

        event.preventDefault();
        selectAudio(row.dataset.audioRow ?? null);
      });
    });

    overlay.querySelectorAll<HTMLButtonElement>("[data-select-audio]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();

        selectAudio(button.dataset.selectAudio ?? null);
      });
    });

    overlay.querySelectorAll<HTMLInputElement>("[data-audio-name]").forEach((input) => {
      input.addEventListener("change", async () => {
        const id = input.dataset.audioName;
        if (!id) return;
        await onRename(id, input.value, { render: false });
        render();
      });
    });

    overlay.querySelectorAll<HTMLButtonElement>("[data-delete-audio]").forEach((button) => {
      button.addEventListener("click", async () => {
        const id = button.dataset.deleteAudio;
        if (!id) return;
        await onDelete(id, { render: false });
        render();
      });
    });
  }

  async function pickFiles() {
    const selected = await open({
      multiple: true,
      filters: [{ name: "Audio", extensions: ["mp3", "wav"] }],
    });

    const paths = Array.isArray(selected) ? selected : typeof selected === "string" ? [selected] : [];
    if (paths.length === 0) return;

    await onImport(paths, { render: false });
    render();
  }

  function selectAudio(audioId: string | null) {
    if (!audioId) return;

    selectedValue = audioId;
    onSelect(selectedValue);
    close();
  }

  async function bindNativeDrop() {
    const webview = getCurrentWebview();
    unlistenDrop = await webview.onDragDropEvent(async (event) => {
      if (closed) return;

      if (event.payload.type === "enter" || event.payload.type === "over") {
        const isOverDropZone = positionIsOverDropZone(event.payload.position);
        if (isDraggingFiles !== isOverDropZone) {
          isDraggingFiles = isOverDropZone;
          render();
        }
      }

      if (event.payload.type === "leave") {
        if (isDraggingFiles) {
          isDraggingFiles = false;
          render();
        }
      }

      if (event.payload.type === "drop") {
        const shouldImport = positionIsOverDropZone(event.payload.position);
        isDraggingFiles = false;
        if (shouldImport) {
          await onImport(event.payload.paths, { render: false });
        }
        render();
      }
    });

    if (closed) {
      unlistenDrop();
    }
  }

  function closeOnEscape(event: KeyboardEvent) {
    if (event.key === "Escape") {
      close();
    }
  }

  function positionIsOverDropZone(position: { x: number; y: number }) {
    const dropZone = overlay.querySelector<HTMLElement>("[data-import-audio]");
    if (!dropZone) return false;

    const scale = window.devicePixelRatio || 1;
    const element = document.elementFromPoint(position.x / scale, position.y / scale);
    return Boolean(element?.closest("[data-import-audio]"));
  }
}

function renderAudioRow(audio: AudioFile, value: string | null) {
  return `
    <article class="modal-audio-row ${value === audio.id ? "selected" : ""}" data-audio-row="${audio.id}" role="button" tabindex="0" aria-label="Обрати ${escapeHtml(audio.displayName)}">
      <button class="sound-select-button" type="button" data-select-audio="${audio.id}" aria-label="Обрати звук" title="Обрати звук">
        ${value === audio.id ? "✓" : "♪"}
      </button>
      <label>
        <input data-audio-name="${audio.id}" value="${escapeHtml(audio.displayName)}" />
      </label>
      <span class="audio-extension">${escapeHtml(audio.extension.toUpperCase())}</span>
      <button class="icon-button danger-button" type="button" data-delete-audio="${audio.id}" aria-label="Видалити композицію" title="Видалити">×</button>
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
