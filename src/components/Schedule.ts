import type { AppState, ScheduleEvent } from "../types";

type StateUpdate = AppState | ((current: AppState) => AppState);

interface ScheduleOptions {
  root: Element | null;
  state: AppState;
  onChange: (state: StateUpdate, options?: { render?: boolean }) => void;
}

export function renderSchedule({ root, state, onChange }: ScheduleOptions) {
  if (!root) return;

  if (state.schedule.length === 0) {
    root.innerHTML = `<p class="empty">Розклад порожній.</p>`;
    return;
  }

  const sorted = [...state.schedule].sort((left, right) => left.order - right.order);
  root.innerHTML = `
    <div class="list schedule-list" data-schedule-list>
      ${sorted.map((event) => renderEventRow(event, state)).join("")}
    </div>
  `;

  root.querySelectorAll<HTMLInputElement>("[data-event-field]").forEach((input) => {
    input.addEventListener("input", () => {
      const id = input.dataset.eventId;
      const field = input.dataset.eventField as "name" | "startTime" | "endTime";
      onChange(
        (current) => ({
          ...current,
          schedule: current.schedule.map((event) => (event.id === id ? { ...event, [field]: input.value } : event)),
        }),
        { render: false },
      );
    });
  });

  root.querySelectorAll<HTMLSelectElement>("[data-preset-select]").forEach((select) => {
    select.addEventListener("change", () => {
      const id = select.dataset.presetSelect;
      onChange((current) => ({
        ...current,
        schedule: current.schedule.map((event) =>
          event.id === id
            ? {
                ...event,
                presetId: select.value === "none" ? null : select.value,
            }
            : event,
        ),
      }));
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-delete-event]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.deleteEvent;
      onChange((current) => ({
        ...current,
        schedule: current.schedule
          .filter((event) => event.id !== id)
          .map((event, index) => ({
            ...event,
            order: index,
          })),
      }));
    });
  });

  wireDragAndDrop(root, onChange);
}

function wireDragAndDrop(root: Element, onChange: ScheduleOptions["onChange"]) {
  let draggedId: string | null = null;

  root.querySelectorAll<HTMLElement>("[data-drag-handle]").forEach((handle) => {
    handle.addEventListener("dragstart", (event) => {
      draggedId = handle.dataset.dragHandle ?? null;
      const row = handle.closest<HTMLElement>("[data-event-row]");

      row?.classList.add("dragging");
      event.dataTransfer?.setData("text/plain", draggedId ?? "");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
      }
    });

    handle.addEventListener("dragend", () => {
      draggedId = null;
      clearDropMarkers(root);
    });
  });

  root.querySelectorAll<HTMLElement>("[data-event-row]").forEach((row) => {
    row.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (!draggedId || row.dataset.eventRow === draggedId) return;

      clearDropMarkers(root);
      row.classList.add(isAfterMiddle(row, event.clientY) ? "drop-after" : "drop-before");
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
    });

    row.addEventListener("drop", (event) => {
      event.preventDefault();
      const sourceId = draggedId ?? event.dataTransfer?.getData("text/plain") ?? null;
      const targetId = row.dataset.eventRow ?? null;
      const placeAfter = isAfterMiddle(row, event.clientY);

      clearDropMarkers(root);

      if (!sourceId || !targetId || sourceId === targetId) {
        return;
      }

      onChange((current) => reorderEvents(current, sourceId, targetId, placeAfter));
    });
  });
}

function reorderEvents(state: AppState, sourceId: string, targetId: string, placeAfter: boolean): AppState {
  const sorted = [...state.schedule].sort((left, right) => left.order - right.order);
  const sourceIndex = sorted.findIndex((event) => event.id === sourceId);
  const targetIndex = sorted.findIndex((event) => event.id === targetId);

  if (sourceIndex < 0 || targetIndex < 0) {
    return state;
  }

  const reordered = [...sorted];
  const [source] = reordered.splice(sourceIndex, 1);
  const targetIndexAfterRemoval = reordered.findIndex((event) => event.id === targetId);
  const insertIndex = targetIndexAfterRemoval + (placeAfter ? 1 : 0);

  reordered.splice(insertIndex, 0, source);

  return {
    ...state,
    schedule: reordered.map((event, index) => ({
      ...event,
      order: index,
    })),
  };
}

function clearDropMarkers(root: Element) {
  root.querySelectorAll("[data-event-row]").forEach((row) => {
    row.classList.remove("dragging", "drop-before", "drop-after");
  });
}

function isAfterMiddle(row: HTMLElement, pointerY: number) {
  const rect = row.getBoundingClientRect();
  return pointerY > rect.top + rect.height / 2;
}

function renderEventRow(event: ScheduleEvent, state: AppState) {
  const isInvalid = event.startTime >= event.endTime;

  return `
    <article class="event-row ${isInvalid ? "invalid" : ""}" data-event-row="${event.id}">
      <div class="drag-handle" draggable="true" data-drag-handle="${event.id}" aria-label="Перемістити подію" title="Перемістити">⋮⋮</div>
      <label>
        <span>Подія</span>
        <input data-event-id="${event.id}" data-event-field="name" value="${escapeHtml(event.name)}" />
      </label>
      <label class="time-field">
        <span>Початок</span>
        <input type="time" data-event-id="${event.id}" data-event-field="startTime" value="${event.startTime}" />
      </label>
      <label class="time-field">
        <span>Кінець</span>
        <input type="time" data-event-id="${event.id}" data-event-field="endTime" value="${event.endTime}" />
      </label>
      <label>
        <span>Пресет</span>
        <select data-preset-select="${event.id}">
          <option value="none" ${event.presetId === null ? "selected" : ""}>Без пресета</option>
          ${state.presets.map((preset) => `<option value="${preset.id}" ${event.presetId === preset.id ? "selected" : ""}>${escapeHtml(preset.name)}</option>`).join("")}
        </select>
      </label>
      <button class="icon-button danger-button" type="button" data-delete-event="${event.id}" aria-label="Видалити подію" title="Видалити">×</button>
      ${isInvalid ? `<p class="row-error">Початок має бути раніше за кінець.</p>` : ""}
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
