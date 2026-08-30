import type { AppState, ScheduleEvent, ScheduleSoundMode, SoundSet } from "../types";
import { openSoundPicker, renderSoundPickerButton } from "./SoundPicker";

type StateUpdate = AppState | ((current: AppState) => AppState);

const visibleTimeErrorEventIds = new Set<string>();

interface ScheduleOptions {
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

export function renderSchedule({
  root,
  state,
  getState,
  onChange,
  onImportAudio,
  onRenameAudio,
  onDeleteAudio,
  onPreviewAudio,
  onStopPreviewAudio,
}: ScheduleOptions) {
  if (!root) return;

  if (state.schedule.length === 0) {
    root.innerHTML = `<p class="empty">Розклад порожній.</p>`;
    return;
  }

  const sorted = [...state.schedule].sort((left, right) => left.order - right.order);
  root.innerHTML = `
    <div class="list schedule-list" data-schedule-list>
      ${sorted.map((event) => renderEventRow(event, state, visibleTimeErrorEventIds.has(event.id))).join("")}
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

      if (field === "startTime" || field === "endTime") {
        const row = input.closest<HTMLElement>("[data-event-row]");

        visibleTimeErrorEventIds.delete(id ?? "");
        syncEventRowValidity(row, false);
      }
    });

    input.addEventListener("focus", () => {
      const id = input.dataset.eventId;
      const field = input.dataset.eventField;

      if (field !== "startTime" && field !== "endTime") return;

      visibleTimeErrorEventIds.delete(id ?? "");
      syncEventRowValidity(input.closest<HTMLElement>("[data-event-row]"), false);
    });
  });

  root.querySelectorAll<HTMLElement>("[data-event-row]").forEach((row) => {
    row.addEventListener("focusout", () => {
      window.setTimeout(() => {
        if (focusIsInsideEventEditingSurface(row)) {
          return;
        }

        const id = row.dataset.eventRow;
        const shouldShowError = rowHasInvalidTime(row);

        if (id && shouldShowError) {
          visibleTimeErrorEventIds.add(id);
        } else if (id) {
          visibleTimeErrorEventIds.delete(id);
        }

        syncEventRowValidity(row, shouldShowError);
      });
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
                ...soundSelectionFromValue(select.value, event.customSounds),
            }
            : event,
        ),
      }));
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-event-sound]").forEach((button) => {
    button.addEventListener("click", () => {
      const eventId = button.dataset.eventId;
      const trigger = button.dataset.eventSound as "before3Min" | "start" | "end";
      const scheduleEvent = state.schedule.find((item) => item.id === eventId);

      if (!scheduleEvent) return;

      openSoundPicker({
        value: scheduleEvent.customSounds[trigger],
        getState,
        onImport: onImportAudio,
        onRename: onRenameAudio,
        onDelete: onDeleteAudio,
        onPreview: onPreviewAudio,
        onStopPreview: onStopPreviewAudio,
        onSelect: (audioId) => {
          onChange((current) => ({
            ...current,
            schedule: current.schedule.map((item) =>
              item.id === eventId
                ? {
                    ...item,
                    customSounds: {
                      ...item.customSounds,
                      [trigger]: audioId,
                    },
                    soundMode: "custom",
                    presetId: null,
                  }
                : item,
            ),
          }));
        },
      });
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-delete-event]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.deleteEvent;
      onChange((current) => {
        if (id) {
          visibleTimeErrorEventIds.delete(id);
        }

        return {
          ...current,
          schedule: current.schedule
            .filter((event) => event.id !== id)
            .map((event, index) => ({
              ...event,
              order: index,
            })),
        };
      });
    });
  });

  wireDragAndDrop(root, onChange);
}

function wireDragAndDrop(root: Element, onChange: ScheduleOptions["onChange"]) {
  let draggedId: string | null = null;
  let dropTargetId: string | null = null;
  let dropAfter = false;

  function updateDropTarget(pointerX: number, pointerY: number) {
    if (!draggedId) return;

    const target = document.elementFromPoint(pointerX, pointerY)?.closest<HTMLElement>("[data-event-row]");
    clearDropMarkers(root, true);

    if (!target || !root.contains(target) || target.dataset.eventRow === draggedId) {
      dropTargetId = null;
      return;
    }

    dropTargetId = target.dataset.eventRow ?? null;
    dropAfter = isAfterMiddle(target, pointerY);
    target.classList.add(dropAfter ? "drop-after" : "drop-before");
  }

  function stopDragging() {
    draggedId = null;
    dropTargetId = null;
    document.body.classList.remove("is-reordering");
    clearDropMarkers(root);
    document.removeEventListener("pointermove", handlePointerMove);
    document.removeEventListener("pointerup", handlePointerUp);
    document.removeEventListener("pointercancel", handlePointerCancel);
  }

  function handlePointerMove(event: PointerEvent) {
    updateDropTarget(event.clientX, event.clientY);
  }

  function handlePointerUp(event: PointerEvent) {
    updateDropTarget(event.clientX, event.clientY);

    const sourceId = draggedId;
    const targetId = dropTargetId;
    const placeAfter = dropAfter;

    stopDragging();

    if (!sourceId || !targetId || sourceId === targetId) {
      return;
    }

    onChange((current) => reorderEvents(current, sourceId, targetId, placeAfter));
  }

  function handlePointerCancel() {
    stopDragging();
  }

  root.querySelectorAll<HTMLElement>("[data-drag-handle]").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !event.isPrimary) return;

      draggedId = handle.dataset.dragHandle ?? null;
      const row = handle.closest<HTMLElement>("[data-event-row]");

      if (!draggedId || !row) return;

      event.preventDefault();
      row?.classList.add("dragging");
      document.body.classList.add("is-reordering");
      document.addEventListener("pointermove", handlePointerMove);
      document.addEventListener("pointerup", handlePointerUp);
      document.addEventListener("pointercancel", handlePointerCancel);
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

function clearDropMarkers(root: Element, keepDragging = false) {
  root.querySelectorAll("[data-event-row]").forEach((row) => {
    row.classList.remove("drop-before", "drop-after");

    if (!keepDragging) {
      row.classList.remove("dragging");
    }
  });
}

function isAfterMiddle(row: HTMLElement, pointerY: number) {
  const rect = row.getBoundingClientRect();
  return pointerY > rect.top + rect.height / 2;
}

function focusIsInsideEventEditingSurface(row: HTMLElement) {
  const activeElement = document.activeElement;

  return Boolean(
    activeElement instanceof HTMLElement &&
      (row.contains(activeElement) || activeElement.closest(".modal")),
  );
}

function rowHasInvalidTime(row: HTMLElement) {
  const startTime = row.querySelector<HTMLInputElement>("[data-event-field='startTime']")?.value ?? "";
  const endTime = row.querySelector<HTMLInputElement>("[data-event-field='endTime']")?.value ?? "";

  return startTime >= endTime;
}

function syncEventRowValidity(row: HTMLElement | null, showError: boolean) {
  if (!row) return;

  const isInvalid = rowHasInvalidTime(row);
  let error = row.querySelector<HTMLParagraphElement>("[data-row-error]");

  row.classList.toggle("invalid", isInvalid && showError);

  if (isInvalid && showError && !error) {
    error = document.createElement("p");
    error.className = "row-error";
    error.dataset.rowError = "time";
    error.textContent = "Початок має бути раніше за кінець.";
    row.append(error);
  }

  if (!isInvalid || !showError) {
    error?.remove();
  }
}

function renderEventRow(event: ScheduleEvent, state: AppState, showTimeError: boolean) {
  const isInvalid = event.startTime >= event.endTime;
  const shouldShowTimeError = isInvalid && showTimeError;
  const soundSelection = soundSelectionValue(event);

  return `
    <article class="event-row ${shouldShowTimeError ? "invalid" : ""}" data-event-row="${event.id}">
      <div class="drag-handle" data-drag-handle="${event.id}" aria-label="Перемістити подію" title="Перемістити">⋮⋮</div>
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
          <option value="none" ${soundSelection === "none" ? "selected" : ""}>Без звуку</option>
          <option value="custom" ${soundSelection === "custom" ? "selected" : ""}>Свій звук</option>
          ${state.presets.map((preset) => `<option value="${preset.id}" ${soundSelection === preset.id ? "selected" : ""}>${escapeHtml(preset.name)}</option>`).join("")}
        </select>
      </label>
      <button class="icon-button danger-button" type="button" data-delete-event="${event.id}" aria-label="Видалити подію" title="Видалити">×</button>
      ${event.soundMode === "custom" ? renderCustomSoundRow(event, state) : ""}
      ${shouldShowTimeError ? `<p class="row-error" data-row-error>Початок має бути раніше за кінець.</p>` : ""}
    </article>
  `;
}

function soundSelectionValue(event: ScheduleEvent) {
  if (event.soundMode === "none" || event.soundMode === "custom") {
    return event.soundMode;
  }

  return event.presetId ?? "none";
}

function soundSelectionFromValue(
  value: string,
  currentCustomSounds: SoundSet,
): { soundMode: ScheduleSoundMode; presetId: string | null; customSounds: SoundSet } {
  if (value === "none") {
    return {
      soundMode: "none",
      presetId: null,
      customSounds: emptySoundSet(),
    };
  }

  if (value === "custom") {
    return {
      soundMode: "custom",
      presetId: null,
      customSounds: currentCustomSounds,
    };
  }

  return {
    soundMode: "preset",
    presetId: value,
    customSounds: emptySoundSet(),
  };
}

function emptySoundSet(): SoundSet {
  return {
    before3Min: null,
    start: null,
    end: null,
  };
}

function renderCustomSoundRow(event: ScheduleEvent, state: AppState) {
  return `
    <div class="event-custom-sounds">
      <label>
        <span>За 3 хв</span>
        ${renderEventSoundPicker(event, "before3Min", state)}
      </label>
      <label>
        <span>Початок</span>
        ${renderEventSoundPicker(event, "start", state)}
      </label>
      <label>
        <span>Кінець</span>
        ${renderEventSoundPicker(event, "end", state)}
      </label>
    </div>
  `;
}

function renderEventSoundPicker(event: ScheduleEvent, trigger: "before3Min" | "start" | "end", state: AppState) {
  const markup = renderSoundPickerButton(event.customSounds[trigger], state.audioLibrary);
  return markup.replace(
    "data-sound-picker",
    `data-sound-picker data-event-id="${event.id}" data-event-sound="${trigger}"`,
  );
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
