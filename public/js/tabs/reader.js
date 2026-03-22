// reader.js — Tab 2: lector con selección y etiquetado

import {
  state, subscribe,
  addExcerpt, addConcept, addConceptToExcerpt,
  findConceptByLabel, getExcerptsForSource, getExcerptsForConcept, getSource,
  removeConcept, renameConcept, removeConceptFromExcerpt, removeExcerpt,
} from "../state.js";
import { navigateTo } from "../router.js";
import { renderHighlightedText, scrollToExcerpt, getRenderedSourceText } from "../components/text-highlighter.js";
import { initExcerptPopup } from "../components/popup.js";
import { initAutocomplete } from "../components/autocomplete.js";
import { renderMinimap } from "../components/minimap.js";
import { renderConceptMap } from "../components/concept-map.js";
import { getSourceText } from "./sources.js";

let currentSourceId = null;
let currentText = null;
let popupController = null;
let autocompleteController = null;
let mapSimulation = null;
let selectedConceptId = null;

export function initReaderTab() {
  const popup = document.getElementById("excerptPopup");
  const readerContent = document.getElementById("readerTextContent");
  const input = document.getElementById("conceptInput");
  const dropdown = document.getElementById("autocompleteDropdown");

  // inicializar popup
  popupController = initExcerptPopup({
    popup,
    readerContent,
    onCreateExcerpt: handleCreateExcerpt,
  });

  // inicializar autocomplete dentro del popup
  const createBtn = document.getElementById("createExcerpt");
  autocompleteController = initAutocomplete(input, dropdown, (conceptData) => {
    input.value = conceptData.label;
    createBtn.click();
  });

  // botón volver
  document.getElementById("backToSources")?.addEventListener("click", () => {
    navigateTo("sources");
  });

  // concept detail: close
  document.getElementById("conceptDetailClose")?.addEventListener("click", () => {
    closeConceptDetail();
  });

  // concept detail: delete
  document.getElementById("conceptDetailDelete")?.addEventListener("click", () => {
    if (!selectedConceptId) return;
    const c = state.concepts[selectedConceptId];
    if (!c) return;
    if (confirm(`¿Eliminar concepto [${c.label}]? Se desvinculará de todos sus excerpts.`)) {
      removeConcept(selectedConceptId);
      closeConceptDetail();
    }
  });

  // concept detail: add section (new excerpt for this concept)
  document.getElementById("conceptDetailAddExcerpt")?.addEventListener("click", () => {
    if (!selectedConceptId || !currentSourceId) return;
    enterAddSectionMode(selectedConceptId);
  });

  // concept detail: rename on blur/enter
  const labelInput = document.getElementById("conceptDetailLabel");
  labelInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      labelInput.blur();
    }
  });
  labelInput?.addEventListener("blur", () => {
    if (!selectedConceptId) return;
    const newLabel = labelInput.value.trim();
    if (newLabel && state.concepts[selectedConceptId] && newLabel !== state.concepts[selectedConceptId].label) {
      renameConcept(selectedConceptId, newLabel);
      showToast(`Concepto renombrado → [${newLabel}]`);
    }
  });

  // re-renderizar cuando cambia el estado
  subscribe(() => {
    if (currentSourceId && currentText) {
      renderReader(currentSourceId, currentText);
    }
  });

  // resizer drag
  initResizer();
}

export async function onReaderActivated(params) {
  const sourceId = params.src;
  if (!sourceId) return;

  if (sourceId === currentSourceId && currentText) {
    renderReader(currentSourceId, currentText);
    if (params.exc) {
      setTimeout(() => {
        scrollToExcerpt(document.getElementById("readerTextContent"), params.exc);
      }, 100);
    }
    return;
  }

  const src = getSource(sourceId);
  if (!src) return;

  document.getElementById("readerTitle").textContent = src.title || src.filename;

  currentSourceId = sourceId;
  const readerContent = document.getElementById("readerTextContent");
  readerContent.innerHTML = `<p class="placeholder">Cargando...</p>`;

  currentText = await getSourceText(sourceId);
  if (!currentText) {
    readerContent.innerHTML = `<p class="placeholder">No se pudo cargar el texto</p>`;
    return;
  }

  closeConceptDetail();
  renderReader(sourceId, currentText);
}

function renderReader(sourceId, text) {
  const readerContent = document.getElementById("readerTextContent");
  const minimapContainer = document.getElementById("readerMinimap");
  const conceptMapContainer = document.getElementById("readerConceptList");
  const conceptCount = document.getElementById("readerConceptCount");

  renderHighlightedText(readerContent, text, sourceId, (excerptId) => {
    // click en un highlight → mostrar detalle del primer concepto
    const exc = state.excerpts[excerptId];
    if (exc && exc.conceptIds.length > 0) {
      openConceptDetail(exc.conceptIds[0]);
    }
  });

  renderMinimap(minimapContainer, sourceId, text.length, readerContent);
  renderReaderConceptMap(conceptMapContainer, conceptCount, sourceId);

  // actualizar detalle si hay uno abierto
  if (selectedConceptId) {
    renderConceptDetailExcerpts(selectedConceptId);
  }
}

function renderReaderConceptMap(container, countEl, sourceId) {
  const excerpts = getExcerptsForSource(sourceId);

  const conceptIds = new Set();
  for (const exc of excerpts) {
    for (const cid of exc.conceptIds) conceptIds.add(cid);
  }
  countEl.textContent = conceptIds.size;

  if (!conceptIds.size) {
    container.innerHTML = `<p class="placeholder" style="font-size: var(--font-size-sm)">
      Selecciona texto para crear el primer concepto [a]
    </p>`;
    return;
  }

  if (mapSimulation) { mapSimulation.stop(); mapSimulation = null; }

  mapSimulation = renderConceptMap(container, {
    style: "title",
    sourceId,
    onClickConcept: (conceptId) => {
      openConceptDetail(conceptId);
    },
  });
}

// ── Concept Detail Panel ──────────────────────────────────────────────────

function openConceptDetail(conceptId) {
  const c = state.concepts[conceptId];
  if (!c) return;

  selectedConceptId = conceptId;
  const panel = document.getElementById("conceptDetail");
  const labelInput = document.getElementById("conceptDetailLabel");

  panel.hidden = false;
  labelInput.value = c.label;

  renderConceptDetailExcerpts(conceptId);

  // scroll al primer excerpt de este concepto en el texto
  const excerpts = getExcerptsForSource(currentSourceId);
  const firstExc = excerpts.find(e => e.conceptIds.includes(conceptId));
  if (firstExc) {
    scrollToExcerpt(document.getElementById("readerTextContent"), firstExc.id);
  }
}

function closeConceptDetail() {
  selectedConceptId = null;
  const panel = document.getElementById("conceptDetail");
  panel.hidden = true;
}

function renderConceptDetailExcerpts(conceptId) {
  const container = document.getElementById("conceptDetailExcerpts");
  const allExcerpts = getExcerptsForConcept(conceptId);

  if (!allExcerpts.length) {
    container.innerHTML = `<p class="placeholder" style="font-size: var(--font-size-sm)">Sin excerpts</p>`;
    return;
  }

  container.innerHTML = allExcerpts.map(exc => {
    const src = state.sources[exc.sourceId];
    const srcLabel = src ? (src.title || src.filename) : "?";
    const preview = exc.text.length > 120 ? exc.text.slice(0, 120) + "…" : exc.text;
    const isCurrentSource = exc.sourceId === currentSourceId;

    return `<div class="concept-detail-excerpt${isCurrentSource ? "" : " other-source"}" data-exc-id="${exc.id}" data-source-id="${exc.sourceId}">
      <button class="excerpt-remove" data-exc-id="${exc.id}" title="Desvincular de este concepto">✕</button>
      §&ensp;${escapeHtml(preview)}
      <div class="excerpt-source">${escapeHtml(srcLabel)}</div>
    </div>`;
  }).join("");

  // click en excerpt → scroll o navegar
  container.querySelectorAll(".concept-detail-excerpt").forEach(el => {
    el.addEventListener("click", (e) => {
      if (e.target.classList.contains("excerpt-remove")) return;
      const excId = el.dataset.excId;
      const srcId = el.dataset.sourceId;

      if (srcId === currentSourceId) {
        scrollToExcerpt(document.getElementById("readerTextContent"), excId);
      } else {
        // navegar al otro source y al excerpt
        navigateTo("reader", { src: srcId, exc: excId });
      }
    });
  });

  // click ✕ → desvincular excerpt de este concepto
  container.querySelectorAll(".excerpt-remove").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const excId = btn.dataset.excId;
      removeConceptFromExcerpt(excId, conceptId);
      // si el excerpt queda sin conceptos, eliminar el excerpt
      const exc = state.excerpts[excId];
      if (exc && exc.conceptIds.length === 0) {
        removeExcerpt(excId);
      }
    });
  });
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Create excerpt ────────────────────────────────────────────────────────

function handleCreateExcerpt({ text, start, end, conceptLabel }) {
  if (!currentSourceId || !conceptLabel) return;

  let concept = findConceptByLabel(conceptLabel);
  let conceptId;

  if (concept) {
    conceptId = concept.id;
  } else {
    conceptId = addConcept(conceptLabel);
  }

  const excerptId = addExcerpt({
    sourceId: currentSourceId,
    text,
    start,
    end,
    conceptIds: [conceptId],
  });

  showToast(`§ marcado como [${conceptLabel}]`);

  setTimeout(() => {
    const readerContent = document.getElementById("readerTextContent");
    scrollToExcerpt(readerContent, excerptId);
    openConceptDetail(conceptId);
  }, 150);
}

// ── Add section mode ──────────────────────────────────────────────────────

let addSectionConceptId = null;

function enterAddSectionMode(conceptId) {
  const c = state.concepts[conceptId];
  if (!c) return;

  addSectionConceptId = conceptId;
  const readerContent = document.getElementById("readerTextContent");
  readerContent.classList.add("add-section-mode");

  showToast(`Selecciona texto para agregar otra § a [${c.label}]`);

  // listener temporal para capturar la selección
  function onMouseUp() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;

    const range = sel.getRangeAt(0);
    const selectedText = sel.toString().trim();
    if (!selectedText) return;

    // calcular offsets en el texto original
    const sourceText = getRenderedSourceText();
    const container = document.getElementById("readerTextContent");

    // usar un TreeWalker para calcular el offset real
    const startOffset = getTextOffset(container, range.startContainer, range.startOffset);
    const endOffset = getTextOffset(container, range.endContainer, range.endOffset);

    if (startOffset === -1 || endOffset === -1 || startOffset >= endOffset) {
      sel.removeAllRanges();
      return;
    }

    // crear excerpt vinculado al concepto
    const excerptId = addExcerpt({
      sourceId: currentSourceId,
      text: sourceText.slice(startOffset, endOffset),
      start: startOffset,
      end: endOffset,
      conceptIds: [addSectionConceptId],
    });

    sel.removeAllRanges();
    exitAddSectionMode();

    showToast(`§ agregada a [${c.label}]`);

    setTimeout(() => {
      scrollToExcerpt(document.getElementById("readerTextContent"), excerptId);
      openConceptDetail(addSectionConceptId);
    }, 150);
  }

  readerContent.addEventListener("mouseup", onMouseUp, { once: true });

  // ESC para cancelar
  function onKeyDown(e) {
    if (e.key === "Escape") {
      exitAddSectionMode();
      document.removeEventListener("keydown", onKeyDown);
      readerContent.removeEventListener("mouseup", onMouseUp);
    }
  }
  document.addEventListener("keydown", onKeyDown);
}

function exitAddSectionMode() {
  addSectionConceptId = null;
  const readerContent = document.getElementById("readerTextContent");
  readerContent.classList.remove("add-section-mode");
}

/**
 * Calcula el offset de texto plano dentro del container,
 * dado un nodo DOM y un offset dentro de ese nodo.
 */
function getTextOffset(container, node, offset) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let pos = 0;

  while (walker.nextNode()) {
    if (walker.currentNode === node) {
      return pos + offset;
    }
    pos += walker.currentNode.textContent.length;
  }
  return -1;
}

function showToast(message) {
  const old = document.querySelector(".excerpt-created-toast");
  if (old) old.remove();

  const toast = document.createElement("div");
  toast.className = "excerpt-created-toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  toast.addEventListener("animationend", () => toast.remove());
}

function initResizer() {
  const resizer = document.getElementById("readerResizer");
  const sidebar = document.getElementById("readerSidebar");
  if (!resizer || !sidebar) return;

  let startX = 0;
  let startW = 0;

  function onMouseDown(e) {
    e.preventDefault();
    startX = e.clientX;
    startW = sidebar.offsetWidth;
    resizer.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  function onMouseMove(e) {
    const dx = e.clientX - startX;
    const newW = Math.max(200, Math.min(window.innerWidth * 0.6, startW + dx));
    sidebar.style.width = newW + "px";
  }

  function onMouseUp() {
    resizer.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    if (currentSourceId && currentText) {
      const container = document.getElementById("readerConceptList");
      const countEl = document.getElementById("readerConceptCount");
      renderReaderConceptMap(container, countEl, currentSourceId);
    }
  }

  resizer.addEventListener("mousedown", onMouseDown);
}
