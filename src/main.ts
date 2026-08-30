import "./styles/main.css";
import { listen } from "@tauri-apps/api/event";
import { confirm, message, open, save } from "@tauri-apps/plugin-dialog";
import {
  deleteAudioFile,
  exportConfig,
  importAudioFiles,
  importConfig,
  loadSchedulerStatus,
  playAudioFile,
  renameAudioFile,
  stopAudioFile,
} from "./api/tauri";
import { loadInitialState, saveState } from "./state/appState";
import { renderPresets } from "./components/Presets";
import { renderSchedule } from "./components/Schedule";
import type { AppState, SchedulerBell, SchedulerError, SchedulerStatus } from "./types";

type StateUpdate = AppState | ((current: AppState) => AppState);

const appRoot = document.querySelector<HTMLDivElement>("#app");

if (!appRoot) {
  throw new Error("App root not found");
}

const app = appRoot;
let state: AppState;
let schedulerStatus: SchedulerStatus = {
  next: null,
  lastFired: null,
  lastError: null,
};
let schedulerEventsReady = false;
let saveVersion = 0;
let saveQueue = Promise.resolve();

function requestSave() {
  if (stateHasInvalidScheduleIntervals(state)) {
    setStatus("");
    return;
  }

  const stateToSave = state;
  const version = ++saveVersion;

  saveQueue = saveQueue.then(async () => {
    if (version !== saveVersion) {
      return;
    }

    try {
      await saveState(stateToSave);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не вдалося зберегти дані", true);
    }
  });
}

function updateState(update: StateUpdate, options: { render?: boolean } = {}) {
  state = typeof update === "function" ? update(state) : update;
  if (options.render ?? true) {
    renderWithTransition();
  }
  requestSave();
}

function stateHasInvalidScheduleIntervals(value: AppState) {
  return value.schedule.some((event) => event.startTime >= event.endTime);
}

function renderWithTransition() {
  const documentWithTransition = document as Document & {
    startViewTransition?: (callback: () => void) => void;
  };

  if (!documentWithTransition.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    render();
    return;
  }

  documentWithTransition.startViewTransition(() => render());
}

function setStatus(text: string, isError = false) {
  const status = document.querySelector<HTMLDivElement>("[data-status]");
  if (!status) return;
  status.textContent = text;
  status.hidden = text.length === 0;
  status.classList.toggle("status-error", isError);
}

async function importAudio(paths: string[], options: { render?: boolean } = {}) {
  const audioPaths = paths.filter((path) => /\.(mp3|wav)$/i.test(path));

  if (audioPaths.length === 0) {
    await message("Підтримуються лише .mp3 та .wav файли.", {
      title: "Years Bell",
      kind: "warning",
    });
    return;
  }

  try {
    state = await importAudioFiles(audioPaths);
    if (options.render ?? true) {
      render();
    }
  } catch (error) {
    await showError(error);
  }
}

async function renameAudio(id: string, displayName: string, options: { render?: boolean } = {}) {
  try {
    state = await renameAudioFile(id, displayName);
    if (options.render ?? true) {
      render();
    }
  } catch (error) {
    await showError(error);
    if (options.render ?? true) {
      render();
    }
  }
}

async function deleteAudio(id: string, options: { render?: boolean } = {}) {
  if (isAudioUsed(id)) {
    await message("Ця композиція використовується у пресетах або подіях. Спочатку приберіть її з усіх полів.", {
      title: "Неможливо видалити",
      kind: "warning",
    });
    return;
  }

  try {
    state = await deleteAudioFile(id);
    if (options.render ?? true) {
      render();
    }
  } catch (error) {
    await showError(error);
  }
}

async function previewAudio(id: string) {
  try {
    await playAudioFile(id);
  } catch (error) {
    await showError(error);
    throw error;
  }
}

async function stopAudioPreview() {
  try {
    await stopAudioFile();
  } catch (error) {
    await showError(error);
  }
}

async function exportConfigArchive() {
  const path = await save({
    defaultPath: "years-bell-config.zip",
    filters: [{ name: "ZIP", extensions: ["zip"] }],
  });

  if (!path) return;

  try {
    await exportConfig(path);
    await message("Конфігурацію експортовано.", {
      title: "Years Bell",
      kind: "info",
    });
  } catch (error) {
    await showError(error);
  }
}

async function importConfigArchive() {
  const selected = await open({
    multiple: false,
    filters: [{ name: "ZIP", extensions: ["zip"] }],
  });
  const path = typeof selected === "string" ? selected : null;

  if (!path) return;

  const confirmed = await confirm(
    "Імпорт перезапише поточний розклад, пресети й бібліотеку звуків. Продовжити?",
    {
      title: "Імпорт конфігурації",
      kind: "warning",
      okLabel: "Імпортувати",
      cancelLabel: "Скасувати",
    },
  );

  if (!confirmed) return;

  try {
    state = await importConfig(path);
    renderWithTransition();
    await message("Конфігурацію імпортовано. Поточні дані перезаписано.", {
      title: "Years Bell",
      kind: "info",
    });
  } catch (error) {
    await showError(error);
  }
}

function isAudioUsed(id: string) {
  return (
    state.presets.some((preset) => Object.values(preset.sounds).includes(id)) ||
    state.schedule.some((event) => Object.values(event.customSounds).includes(id))
  );
}

async function showError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  setStatus(text, true);
  await message(text, { title: "Помилка", kind: "error" });
}

async function setupSchedulerEvents() {
  if (schedulerEventsReady) return;

  schedulerEventsReady = true;

  await listen<SchedulerStatus>("scheduler-status", (event) => {
    schedulerStatus = event.payload;
    syncSchedulerStatus();
  });

  await listen<SchedulerBell>("bell-fired", (event) => {
    schedulerStatus = {
      ...schedulerStatus,
      lastFired: event.payload,
      lastError: null,
    };
    syncSchedulerStatus();
  });

  await listen<SchedulerError>("scheduler-error", (event) => {
    schedulerStatus = {
      ...schedulerStatus,
      lastError: event.payload.message,
    };
    setStatus(event.payload.message, true);
    syncSchedulerStatus();
  });
}

function syncSchedulerStatus() {
  const status = document.querySelector<HTMLDivElement>("[data-scheduler-status]");
  if (!status) return;

  status.innerHTML = renderSchedulerStatus();
  status.classList.toggle("scheduler-card-error", Boolean(schedulerStatus.lastError));
}

function renderSchedulerStatus() {
  if (schedulerStatus.lastError) {
    return `
      <span>Планувальник</span>
      <strong>Помилка відтворення</strong>
      <small>${escapeHtml(schedulerStatus.lastError)}</small>
    `;
  }

  if (!schedulerStatus.next) {
    return `
      <span>Наступний дзвінок</span>
      <strong>Немає на сьогодні</strong>
      <small>Планувальник працює у фоні</small>
    `;
  }

  const next = schedulerStatus.next;

  return `
    <span>Наступний дзвінок</span>
    <strong>${escapeHtml(next.time)} · ${escapeHtml(next.eventName)}</strong>
    <small>${escapeHtml(next.triggerLabel)} · ${escapeHtml(next.audioName)}</small>
  `;
}

function render() {
  app.innerHTML = `
    <main class="shell">
      <header class="app-header">
        <div>
          <p class="eyebrow">Years Bell</p>
          <h1>Розклад шкільних дзвінків</h1>
        </div>
        <div class="header-status">
          <div class="transfer-island">
            <button class="transfer-button" type="button" data-transfer-menu aria-label="Імпорт та експорт конфігурації" title="Імпорт / експорт">
              ${renderTransferIcon()}
            </button>
            <div class="transfer-menu" data-transfer-popover hidden>
              <button type="button" data-action="import-presets">Імпортувати</button>
              <button type="button" data-action="export-presets">Експортувати</button>
            </div>
          </div>
          <div class="scheduler-card" data-scheduler-status>${renderSchedulerStatus()}</div>
          <div class="status" data-status hidden></div>
        </div>
      </header>
      <section class="panel">
        <div class="section-heading">
          <div>
            <h2>Пресети звуків</h2>
            <p>Набори звуків для подій, що повторюються: уроків, обідів і тп.</p>
          </div>
          <button class="add-button" type="button" data-action="add-preset" aria-label="Новий пресет" title="Новий пресет"><span aria-hidden="true">+</span></button>
        </div>
        <div data-presets></div>
      </section>
      <section class="panel">
        <div class="section-heading">
          <div>
            <h2>Розклад</h2>
            <p>Події розкладу зі звуком. Уроки, обіди, хвилина мовчання.</p>
          </div>
        </div>
        <div data-schedule></div>
        <div class="section-footer">
          <button class="add-button" type="button" data-action="add-event" aria-label="Нова подія" title="Нова подія"><span aria-hidden="true">+</span></button>
        </div>
      </section>
    </main>
  `;

  renderPresets({
    root: app.querySelector("[data-presets]"),
    state,
    getState: () => state,
    onChange: updateState,
    onImportAudio: importAudio,
    onRenameAudio: renameAudio,
    onDeleteAudio: deleteAudio,
    onPreviewAudio: previewAudio,
    onStopPreviewAudio: stopAudioPreview,
  });

  renderSchedule({
    root: app.querySelector("[data-schedule]"),
    state,
    getState: () => state,
    onChange: updateState,
    onImportAudio: importAudio,
    onRenameAudio: renameAudio,
    onDeleteAudio: deleteAudio,
    onPreviewAudio: previewAudio,
    onStopPreviewAudio: stopAudioPreview,
  });

  app.querySelector<HTMLButtonElement>("[data-action='add-preset']")?.addEventListener("click", () => {
    const nextOrder = state.presets.length + 1;
    updateState({
      ...state,
      presets: [
        ...state.presets,
        {
          id: crypto.randomUUID(),
          name: `Пресет ${nextOrder}`,
          sounds: {
            before3Min: null,
            start: null,
            end: null,
          },
        },
      ],
    });
  });

  app.querySelectorAll<HTMLButtonElement>("[data-action='add-event']").forEach((button) => {
    button.addEventListener("click", () => {
      const nextOrder = state.schedule.length;
      updateState({
        ...state,
        schedule: [
          ...state.schedule,
          {
            id: crypto.randomUUID(),
            name: `${nextOrder + 1} урок`,
            startTime: "08:30",
            endTime: "09:15",
            order: nextOrder,
            soundMode: state.presets[0] ? "preset" : "none",
            presetId: state.presets[0]?.id ?? null,
            customSounds: {
              before3Min: null,
              start: null,
              end: null,
            },
          },
        ],
      });
    });
  });

  const transferIsland = app.querySelector<HTMLElement>(".transfer-island");
  const transferMenuButton = app.querySelector<HTMLButtonElement>("[data-transfer-menu]");
  const transferMenu = app.querySelector<HTMLElement>("[data-transfer-popover]");

  transferIsland?.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  transferMenuButton?.addEventListener("click", () => {
    if (!transferMenu) return;

    transferMenu.hidden = !transferMenu.hidden;

    if (!transferMenu.hidden) {
      document.addEventListener(
        "click",
        () => {
          transferMenu.hidden = true;
        },
        { once: true },
      );
    }
  });

  app.querySelector<HTMLButtonElement>("[data-action='import-presets']")?.addEventListener("click", async () => {
    if (transferMenu) {
      transferMenu.hidden = true;
    }
    await importConfigArchive();
  });

  app.querySelector<HTMLButtonElement>("[data-action='export-presets']")?.addEventListener("click", async () => {
    if (transferMenu) {
      transferMenu.hidden = true;
    }
    await exportConfigArchive();
  });
}

function renderTransferIcon() {
  return `
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M7 7h10M7 17h10" />
      <path d="M14 4l3 3-3 3M10 14l-3 3 3 3" />
    </svg>
  `;
}

async function boot() {
  app.innerHTML = `<main class="shell"><div class="status">Завантаження...</div></main>`;

  try {
    await setupSchedulerEvents();
    state = await loadInitialState();
    schedulerStatus = await loadSchedulerStatus();
    render();
  } catch (error) {
    app.innerHTML = `
      <main class="shell">
        <section class="panel">
          <h1>Не вдалося запустити застосунок</h1>
          <p class="error-text">${error instanceof Error ? error.message : "Unknown error"}</p>
        </section>
      </main>
    `;
  }
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

void boot();
