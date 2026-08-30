import "./styles/main.css";
import { loadInitialState, saveState } from "./state/appState";
import { renderPresets } from "./components/Presets";
import { renderSchedule } from "./components/Schedule";
import type { AppState } from "./types";

type StateUpdate = AppState | ((current: AppState) => AppState);

const appRoot = document.querySelector<HTMLDivElement>("#app");

if (!appRoot) {
  throw new Error("App root not found");
}

const app = appRoot;
let state: AppState;
let saveVersion = 0;
let saveQueue = Promise.resolve();

function requestSave() {
  const version = ++saveVersion;

  saveQueue = saveQueue.then(async () => {
    if (version !== saveVersion) {
      return;
    }

    try {
      await saveState(state);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Не вдалося зберегти дані", true);
    }
  });
}

function updateState(update: StateUpdate, options: { render?: boolean } = {}) {
  state = typeof update === "function" ? update(state) : update;
  if (options.render ?? true) {
    render();
  }
  requestSave();
}

function setStatus(text: string, isError = false) {
  const status = document.querySelector<HTMLDivElement>("[data-status]");
  if (!status) return;
  status.textContent = text;
  status.hidden = text.length === 0;
  status.classList.toggle("status-error", isError);
}

function render() {
  app.innerHTML = `
    <main class="shell">
      <header class="app-header">
        <div>
          <p class="eyebrow">Years Bell</p>
          <h1>Розклад шкільних дзвінків</h1>
        </div>
        <div class="status" data-status hidden></div>
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
          <button class="add-button" type="button" data-action="add-event" aria-label="Нова подія" title="Нова подія"><span aria-hidden="true">+</span></button>
        </div>
        <div data-schedule></div>
      </section>
    </main>
  `;

  renderPresets({
    root: app.querySelector("[data-presets]"),
    state,
    onChange: updateState,
  });

  renderSchedule({
    root: app.querySelector("[data-schedule]"),
    state,
    onChange: updateState,
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

  app.querySelector<HTMLButtonElement>("[data-action='add-event']")?.addEventListener("click", () => {
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
}

async function boot() {
  app.innerHTML = `<main class="shell"><div class="status">Завантаження...</div></main>`;

  try {
    state = await loadInitialState();
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

void boot();
