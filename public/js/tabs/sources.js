// sources.js — Tab 1: gestión del corpus

import { api } from "../api.js";
import { state, addSource, getExcerptsForSource, subscribe } from "../state.js";
import { navigateTo } from "../router.js";

// cache de textos cargados (filename → text)
const textCache = new Map();

export async function initSourcesTab() {
  await renderSourcesList();
  subscribe(() => renderSourcesList());
}

export function onSourcesActivated() {
  renderSourcesList();
}

async function renderSourcesList() {
  const listEl = document.getElementById("sourcesListContent");
  const countEl = document.getElementById("sourcesCount");
  if (!listEl) return;

  // obtener archivos del corpus
  let corpusFiles = [];
  try {
    const res = await api.listCorpus();
    corpusFiles = res.files || [];
  } catch {}

  // merge: sources del estado + archivos aún no importados
  const imported = new Set(Object.values(state.sources).map(s => s.filename));
  const all = [];

  // primero los ya importados
  for (const src of Object.values(state.sources)) {
    const excerpts = getExcerptsForSource(src.id);
    all.push({ ...src, excerptCount: excerpts.length, imported: true });
  }

  // luego los pendientes
  for (const f of corpusFiles) {
    if (!imported.has(f.filename)) {
      all.push({
        filename: f.filename,
        title: f.filename.replace(/\.txt$/, ""),
        size: f.size,
        imported: false,
      });
    }
  }

  countEl.textContent = all.length;

  if (!all.length) {
    listEl.innerHTML = `<p class="placeholder">Coloca archivos .txt en la carpeta corpus/</p>`;
    return;
  }

  listEl.innerHTML = `<div class="source-list">${all.map(s => renderSourceCard(s)).join("")}</div>`;

  // event listeners
  listEl.querySelectorAll(".source-card").forEach(card => {
    card.addEventListener("click", () => handleSourceClick(card.dataset.filename, card.dataset.sourceId));
    card.addEventListener("mouseenter", () => previewSource(card.dataset.filename));
  });
}

function renderSourceCard(src) {
  const pct = src.wordCount > 0 ? Math.round((countMarkedChars(src.id) / (src.wordCount * 5)) * 100) : 0;

  return `
    <div class="card source-card" data-filename="${src.filename}" data-source-id="${src.id || ""}">
      <h3>${escapeHtml(src.title || src.filename)}</h3>
      <div class="source-meta">
        ${src.imported
          ? `<span class="stat">${src.excerptCount || 0} §</span>
             <span class="stat">${src.wordCount || "?"} palabras</span>`
          : `<span class="stat" style="color:var(--accent)">Por importar</span>
             <span class="stat">${src.size ? Math.round(src.size / 1024) + " KB" : ""}</span>`
        }
      </div>
      ${src.imported && src.wordCount > 0 ? `
        <div class="source-progress">
          <div class="source-progress-bar" style="width: ${Math.min(pct, 100)}%"></div>
        </div>
      ` : ""}
    </div>
  `;
}

async function handleSourceClick(filename, sourceId) {
  if (sourceId) {
    // ya importado → ir al reader
    navigateTo("reader", { src: sourceId });
    return;
  }

  // importar el texto
  try {
    const res = await api.readSource(filename);
    const words = res.text.split(/\s+/).length;
    const id = addSource({
      filename,
      title: filename.replace(/\.txt$/, ""),
      wordCount: words,
    });
    textCache.set(filename, res.text);
    navigateTo("reader", { src: id });
  } catch (e) {
    console.error("Error importando:", e);
  }
}

async function previewSource(filename) {
  const previewEl = document.getElementById("sourcePreviewContent");
  if (!previewEl) return;

  // buscar en cache
  if (textCache.has(filename)) {
    showPreview(previewEl, textCache.get(filename));
    return;
  }

  previewEl.innerHTML = `<p class="placeholder">Cargando...</p>`;
  try {
    const res = await api.readSource(filename);
    textCache.set(filename, res.text);
    showPreview(previewEl, res.text);
  } catch {
    previewEl.innerHTML = `<p class="placeholder">No se pudo cargar el texto</p>`;
  }
}

function showPreview(el, text) {
  const maxChars = 3000;
  const truncated = text.length > maxChars;
  el.textContent = truncated ? text.slice(0, maxChars) : text;
  if (truncated) {
    el.innerHTML += `<p class="preview-truncated">... (${text.length.toLocaleString()} caracteres en total)</p>`;
  }
}

function countMarkedChars(sourceId) {
  if (!sourceId) return 0;
  const excerpts = getExcerptsForSource(sourceId);
  const chars = new Set();
  for (const e of excerpts) {
    if (typeof e.start === "number" && typeof e.end === "number") {
      for (let i = e.start; i < e.end; i++) chars.add(i);
    }
  }
  return chars.size;
}

/**
 * Obtiene el texto de un source (desde cache o servidor).
 */
export async function getSourceText(sourceId) {
  const src = state.sources[sourceId];
  if (!src) return null;
  if (textCache.has(src.filename)) return textCache.get(src.filename);
  try {
    const res = await api.readSource(src.filename);
    textCache.set(src.filename, res.text);
    return res.text;
  } catch {
    return null;
  }
}

function escapeHtml(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
