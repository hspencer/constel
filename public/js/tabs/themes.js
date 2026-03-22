// themes.js — Tab 3: mapa de conceptos + gestión de temas + notas

import {
  state, subscribe,
  addTheme, removeTheme, renameTheme,
  moveConcept, mergeConcepts,
  addNote, updateNote, getNotesForTheme,
  getConceptsForTheme, getUngroupedConcepts,
  getExcerptsForConcept, getThemeColor,
} from "../state.js";
import { navigateTo } from "../router.js";
import { renderConceptMap } from "../components/concept-map.js";

let currentSelection = null; // { type: "concept"|"theme", id: string }
let simulation = null;

export function initThemesTab() {
  subscribe(() => {
    if (document.getElementById("panel-themes")?.classList.contains("active")) {
      renderThemeDetail();
    }
  });
}

export function onThemesActivated() {
  renderMap();
  renderThemeDetail();
}

function renderMap() {
  const container = document.getElementById("mapContainer");
  if (!container) return;

  // limpiar simulación anterior
  if (simulation) { simulation.stop(); simulation = null; }

  const style = document.querySelector("[data-map-style].active")?.dataset.mapStyle || "circular";

  simulation = renderConceptMap(container, {
    style,
    onClickConcept: (conceptId) => {
      currentSelection = { type: "concept", id: conceptId };
      renderThemeDetail();
    },
  });

  // controles de estilo del mapa
  document.querySelectorAll("[data-map-style]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-map-style]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderMap();
    });
  });
}

function renderThemeDetail() {
  const container = document.getElementById("themeDetailContent");
  const titleEl = document.getElementById("themeDetailTitle");
  if (!container) return;

  if (currentSelection?.type === "concept") {
    renderConceptDetail(container, titleEl, currentSelection.id);
  } else if (currentSelection?.type === "theme") {
    renderThemeNotes(container, titleEl, currentSelection.id);
  } else {
    renderThemeOverview(container, titleEl);
  }
}

function renderThemeOverview(container, titleEl) {
  titleEl.textContent = "Temas";

  const themes = Object.values(state.themes);
  const ungrouped = getUngroupedConcepts();

  let html = "";

  for (const theme of themes) {
    const concepts = getConceptsForTheme(theme.id);
    const notes = getNotesForTheme(theme.id);
    html += `
      <div class="theme-section">
        <div class="theme-section-header">
          <span class="theme-color-dot" style="background: ${theme.color}"></span>
          <h3 class="theme-label" data-theme="${theme.id}">${escapeHtml(theme.label)}</h3>
          <span class="badge">${concepts.length}</span>
          <button class="btn-sm" data-select-theme="${theme.id}">→</button>
        </div>
        <div class="theme-concepts">
          ${concepts.map(c => `
            <span class="concept-tag" style="border-color: ${theme.color}; background: ${theme.color}20"
                  data-select-concept="${c.id}">
              ${escapeHtml(c.label)}
            </span>
          `).join("")}
        </div>
      </div>
    `;
  }

  if (ungrouped.length) {
    html += `
      <div class="ungrouped-section">
        <div class="theme-section-header">
          <h3>Sin agrupar</h3>
          <span class="badge">${ungrouped.length}</span>
        </div>
        <div class="theme-concepts">
          ${ungrouped.map(c => `
            <span class="concept-tag" style="border-color: var(--muted)"
                  data-select-concept="${c.id}">
              ${escapeHtml(c.label)}
            </span>
          `).join("")}
        </div>
      </div>
    `;
  }

  // formulario nuevo tema
  html += `
    <div class="new-theme-form">
      <input type="text" id="newThemeInput" placeholder="Nuevo tema...">
      <button class="btn-primary btn-sm" id="createThemeBtn">Crear</button>
    </div>
  `;

  container.innerHTML = html;

  // listeners
  container.querySelectorAll("[data-select-theme]").forEach(btn => {
    btn.addEventListener("click", () => {
      currentSelection = { type: "theme", id: btn.dataset.selectTheme };
      renderThemeDetail();
    });
  });

  container.querySelectorAll("[data-select-concept]").forEach(tag => {
    tag.addEventListener("click", () => {
      currentSelection = { type: "concept", id: tag.dataset.selectConcept };
      renderThemeDetail();
    });
  });

  document.getElementById("createThemeBtn")?.addEventListener("click", () => {
    const input = document.getElementById("newThemeInput");
    const label = input?.value.trim();
    if (label) {
      addTheme(label);
      input.value = "";
    }
  });

  document.getElementById("newThemeInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("createThemeBtn")?.click();
  });
}

function renderConceptDetail(container, titleEl, conceptId) {
  const concept = state.concepts[conceptId];
  if (!concept) { renderThemeOverview(container, titleEl); return; }

  titleEl.textContent = concept.label;

  const excerpts = getExcerptsForConcept(conceptId);
  const themes = Object.values(state.themes);

  let html = `
    <div style="margin-bottom: var(--space-md)">
      <label style="font-size: var(--font-size-sm); color: var(--muted)">Tema:</label>
      <select id="conceptThemeSelect" style="margin-left: var(--space-sm); padding: var(--space-xs)">
        <option value="">Sin agrupar</option>
        ${themes.map(t => `
          <option value="${t.id}" ${concept.themeId === t.id ? "selected" : ""}>
            ${escapeHtml(t.label)}
          </option>
        `).join("")}
      </select>
    </div>
    <div style="margin-bottom: var(--space-md)">
      <label style="font-size: var(--font-size-sm); color: var(--muted)">${excerpts.length} excerpts (§)</label>
    </div>
    <div class="excerpt-list">
      ${excerpts.map(exc => {
        const src = state.sources[exc.sourceId];
        return `
          <div class="excerpt-item" data-source="${exc.sourceId}" data-excerpt="${exc.id}">
            ${escapeHtml(exc.text.slice(0, 200))}${exc.text.length > 200 ? "..." : ""}
            <div class="excerpt-source">${escapeHtml(src?.title || src?.filename || "?")}</div>
          </div>
        `;
      }).join("")}
    </div>
    <button class="btn-sm" style="margin-top: var(--space-md)" id="backToOverview">← Todos los temas</button>
  `;

  container.innerHTML = html;

  // cambiar tema del concept
  container.querySelector("#conceptThemeSelect")?.addEventListener("change", (e) => {
    moveConcept(conceptId, e.target.value || null);
    renderMap();
  });

  // click en excerpt → ir al reader
  container.querySelectorAll(".excerpt-item").forEach(item => {
    item.addEventListener("click", () => {
      navigateTo("reader", { src: item.dataset.source, exc: item.dataset.excerpt });
    });
  });

  container.querySelector("#backToOverview")?.addEventListener("click", () => {
    currentSelection = null;
    renderThemeDetail();
  });
}

function renderThemeNotes(container, titleEl, themeId) {
  const theme = state.themes[themeId];
  if (!theme) { renderThemeOverview(container, titleEl); return; }

  titleEl.textContent = theme.label;

  const concepts = getConceptsForTheme(themeId);
  const notes = getNotesForTheme(themeId);
  const allExcerpts = concepts.flatMap(c => getExcerptsForConcept(c.id));

  // deduplicar excerpts
  const seen = new Set();
  const excerpts = allExcerpts.filter(e => { if (seen.has(e.id)) return false; seen.add(e.id); return true; });

  let html = `
    <div class="theme-section-header" style="margin-bottom: var(--space-md)">
      <span class="theme-color-dot" style="background: ${theme.color}"></span>
      <h3>${escapeHtml(theme.label)}</h3>
      <span class="badge">${concepts.length} conceptos · ${excerpts.length} §</span>
    </div>

    <div class="theme-concepts" style="margin-bottom: var(--space-md)">
      ${concepts.map(c => `
        <span class="concept-tag" style="border-color: ${theme.color}; background: ${theme.color}20"
              data-select-concept="${c.id}">
          ${escapeHtml(c.label)}
        </span>
      `).join("")}
    </div>

    <div class="note-editor">
      <label>Notas {n} — texto emergente</label>
      <textarea id="themeNoteText" placeholder="Escribe aquí tu síntesis, implicancias, argumentos...">${escapeHtml(notes[0]?.text || "")}</textarea>
    </div>

    <details style="margin-top: var(--space-md)">
      <summary style="cursor: pointer; color: var(--muted); font-size: var(--font-size-sm)">
        ${excerpts.length} excerpts de este tema
      </summary>
      <div class="excerpt-list" style="margin-top: var(--space-sm)">
        ${excerpts.map(exc => {
          const src = state.sources[exc.sourceId];
          return `
            <div class="excerpt-item" data-source="${exc.sourceId}" data-excerpt="${exc.id}">
              ${escapeHtml(exc.text.slice(0, 200))}${exc.text.length > 200 ? "..." : ""}
              <div class="excerpt-source">${escapeHtml(src?.title || "?")}</div>
            </div>
          `;
        }).join("")}
      </div>
    </details>

    <button class="btn-sm" style="margin-top: var(--space-md)" id="backToOverview">← Todos los temas</button>
  `;

  container.innerHTML = html;

  // guardar nota con debounce
  let noteTimer;
  const textarea = container.querySelector("#themeNoteText");
  textarea?.addEventListener("input", () => {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => {
      const text = textarea.value;
      if (notes[0]) {
        updateNote(notes[0].id, text);
      } else if (text.trim()) {
        addNote(themeId, text);
      }
    }, 500);
  });

  // clicks
  container.querySelectorAll("[data-select-concept]").forEach(tag => {
    tag.addEventListener("click", () => {
      currentSelection = { type: "concept", id: tag.dataset.selectConcept };
      renderThemeDetail();
    });
  });

  container.querySelectorAll(".excerpt-item").forEach(item => {
    item.addEventListener("click", () => {
      navigateTo("reader", { src: item.dataset.source, exc: item.dataset.excerpt });
    });
  });

  container.querySelector("#backToOverview")?.addEventListener("click", () => {
    currentSelection = null;
    renderThemeDetail();
  });
}

function escapeHtml(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
