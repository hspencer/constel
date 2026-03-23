// state.js — store central con pub/sub y persistencia
// Todas las entidades se gestionan aquí.

import { api } from "./api.js";

// ── Configuración ────────────────────────────────────────────────────────────
// USE_LOCAL_STORAGE: true = usa localStorage como cache (útil para GitHub Pages)
//                    false = solo disco vía servidor (evita datos fantasma)
const USE_LOCAL_STORAGE = false;

// ── Estado ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = "constel-state";

export const state = {
  version: 1,
  updatedAt: null,
  sessionId: "",
  sources: {},
  excerpts: {},
  concepts: {},
  themes: {},
  notes: {},
};

// ── Pub/Sub ─────────────────────────────────────────────────────────────────

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let saveTimer = null;

export function notify() {
  state.updatedAt = new Date().toISOString();
  // localStorage (si habilitado)
  if (USE_LOCAL_STORAGE) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  }
  // debounce disco
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveToDisk, 300);
  // notificar suscriptores
  for (const fn of listeners) {
    try { fn(state); } catch (e) { console.error("subscriber error:", e); }
  }
}

async function saveToDisk() {
  try {
    await api.putDb(state);
  } catch (e) {
    console.error("Error guardando en disco:", e);
  }
}

// ── Carga inicial ───────────────────────────────────────────────────────────

export async function loadState() {
  // 1. localStorage (si habilitado)
  if (USE_LOCAL_STORAGE) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) Object.assign(state, JSON.parse(raw));
    } catch {}
  }
  // 2. disco (servidor) — siempre gana si está disponible
  try {
    const disk = await api.getDb();
    if (disk && disk.updatedAt) {
      if (!USE_LOCAL_STORAGE || !state.updatedAt || disk.updatedAt > state.updatedAt) {
        Object.assign(state, disk);
        if (USE_LOCAL_STORAGE) {
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
        }
      }
    }
  } catch (e) {
    console.warn("No se pudo leer del servidor, usando localStorage:", e);
  }
  // Si localStorage desactivado, limpiar residuos
  if (!USE_LOCAL_STORAGE) {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }
}

// ── Generador de IDs ────────────────────────────────────────────────────────

function makeId(prefix) {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${ts}${rand}`;
}

// ── CRUD: Sources ───────────────────────────────────────────────────────────

export function addSource({ filename, title, author, date, wordCount }) {
  const id = makeId("src");
  state.sources[id] = {
    id, filename, title: title || filename.replace(/\.(txt|md)$/, ""),
    author: author || "", date: date || "",
    wordCount: wordCount || 0,
    addedAt: new Date().toISOString(),
  };
  notify();
  return id;
}

export function removeSource(id) {
  // eliminar excerpts asociados
  for (const [eid, exc] of Object.entries(state.excerpts)) {
    if (exc.sourceId === id) delete state.excerpts[eid];
  }
  delete state.sources[id];
  notify();
}

export function updateSource(id, fields) {
  const s = state.sources[id];
  if (!s) return;
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) s[k] = v;
  }
  notify();
}

export function getSource(id) {
  return state.sources[id] || null;
}

// ── CRUD: Excerpts ──────────────────────────────────────────────────────────

export function addExcerpt({ sourceId, text, start, end, conceptIds }) {
  const id = makeId("exc");
  state.excerpts[id] = {
    id, sourceId, text, start, end,
    conceptIds: conceptIds || [],
    createdAt: new Date().toISOString(),
  };
  notify();
  return id;
}

export function removeExcerpt(id) {
  delete state.excerpts[id];
  notify();
}

export function addConceptToExcerpt(excerptId, conceptId) {
  const exc = state.excerpts[excerptId];
  if (!exc) return;
  if (!exc.conceptIds.includes(conceptId)) {
    exc.conceptIds.push(conceptId);
    notify();
  }
}

export function removeConceptFromExcerpt(excerptId, conceptId) {
  const exc = state.excerpts[excerptId];
  if (!exc) return;
  exc.conceptIds = exc.conceptIds.filter(id => id !== conceptId);
  notify();
}

export function getExcerptsForSource(sourceId) {
  return Object.values(state.excerpts).filter(e => e.sourceId === sourceId);
}

export function getExcerptsForConcept(conceptId) {
  return Object.values(state.excerpts).filter(e => e.conceptIds.includes(conceptId));
}

// ── CRUD: Concepts ──────────────────────────────────────────────────────────

export function addConcept(label, themeId = null) {
  const id = makeId("con");
  state.concepts[id] = {
    id, label, themeId,
    createdAt: new Date().toISOString(),
  };
  notify();
  return id;
}

export function removeConcept(id) {
  // eliminar de excerpts
  for (const exc of Object.values(state.excerpts)) {
    exc.conceptIds = exc.conceptIds.filter(cid => cid !== id);
  }
  delete state.concepts[id];
  notify();
}

export function renameConcept(id, newLabel) {
  const c = state.concepts[id];
  if (c) { c.label = newLabel; notify(); }
}

export function moveConcept(id, newThemeId) {
  const c = state.concepts[id];
  if (c) { c.themeId = newThemeId; notify(); }
}

export function mergeConcepts(keepId, removeId) {
  // reasignar excerpts del removido al que se conserva
  for (const exc of Object.values(state.excerpts)) {
    const idx = exc.conceptIds.indexOf(removeId);
    if (idx !== -1) {
      exc.conceptIds[idx] = keepId;
      // deduplicar
      exc.conceptIds = [...new Set(exc.conceptIds)];
    }
  }
  delete state.concepts[removeId];
  notify();
}

export function findConceptByLabel(label) {
  const norm = label.toLowerCase().trim();
  return Object.values(state.concepts).find(c => c.label.toLowerCase().trim() === norm) || null;
}

export function getAllConceptLabels() {
  return Object.values(state.concepts).map(c => ({
    id: c.id,
    label: c.label,
    count: getExcerptsForConcept(c.id).length,
  }));
}

export function getConceptsForTheme(themeId) {
  return Object.values(state.concepts).filter(c => c.themeId === themeId);
}

export function getUngroupedConcepts() {
  return Object.values(state.concepts).filter(c => !c.themeId);
}

// ── CRUD: Themes ────────────────────────────────────────────────────────────

const THEME_COLORS = [
  "#2d6a5a", "#6366f1", "#d97706", "#dc2626",
  "#7c3aed", "#0891b2", "#65a30d", "#be185d",
  "#0d9488", "#4338ca", "#ea580c", "#9333ea",
];

export function addTheme(label) {
  const id = makeId("thm");
  const idx = Object.keys(state.themes).length;
  state.themes[id] = {
    id, label,
    color: THEME_COLORS[idx % THEME_COLORS.length],
    sortOrder: idx,
    createdAt: new Date().toISOString(),
  };
  notify();
  return id;
}

export function removeTheme(id) {
  // des-agrupar concepts de este tema
  for (const c of Object.values(state.concepts)) {
    if (c.themeId === id) c.themeId = null;
  }
  // eliminar notas del tema
  for (const [nid, n] of Object.entries(state.notes)) {
    if (n.themeId === id) delete state.notes[nid];
  }
  delete state.themes[id];
  notify();
}

export function renameTheme(id, newLabel) {
  const t = state.themes[id];
  if (t) { t.label = newLabel; notify(); }
}

export function getThemeColor(themeId) {
  return state.themes[themeId]?.color || "#888";
}

// ── CRUD: Notes ─────────────────────────────────────────────────────────────

export function addNote(themeId, text) {
  const id = makeId("note");
  state.notes[id] = {
    id, themeId, text,
    updatedAt: new Date().toISOString(),
  };
  notify();
  return id;
}

export function updateNote(id, text) {
  const n = state.notes[id];
  if (n) {
    n.text = text;
    n.updatedAt = new Date().toISOString();
    notify();
  }
}

export function removeNote(id) {
  delete state.notes[id];
  notify();
}

export function getNotesForTheme(themeId) {
  return Object.values(state.notes).filter(n => n.themeId === themeId);
}

// ── Queries de grafo ────────────────────────────────────────────────────────

/**
 * Computa el grafo de conceptos.
 *
 * Solo co-excerpt: dos conceptos se conectan si el investigador
 * los etiquetó en el MISMO pasaje. Esto refleja decisiones
 * explícitas del lector, no accidentes del texto.
 *
 * @param {string|null} sourceId - filtrar a un source, o null para global
 * @returns {{ nodes, links }}
 */
export function computeConceptGraph(sourceId = null) {
  const excerpts = sourceId
    ? Object.values(state.excerpts).filter(e => e.sourceId === sourceId)
    : Object.values(state.excerpts);

  // solo conceptos que aparecen en estos excerpts
  const conceptIds = new Set();
  for (const exc of excerpts) {
    for (const cid of exc.conceptIds) conceptIds.add(cid);
  }
  const concepts = [...conceptIds].map(id => state.concepts[id]).filter(Boolean);

  // nodos — conteo global
  const allExcerpts = Object.values(state.excerpts);
  const nodes = concepts.map(c => {
    const relevantExc = allExcerpts.filter(e => e.conceptIds.includes(c.id));
    const sourceSet = new Set(relevantExc.map(e => e.sourceId));
    return {
      id: c.id,
      label: c.label,
      themeId: c.themeId,
      excerptCount: relevantExc.length,
      sourceCount: sourceSet.size,
    };
  });

  // ── Links: solo co-excerpt ──
  const linkMap = new Map();

  function linkKey(a, b) {
    return a < b ? `${a}::${b}` : `${b}::${a}`;
  }

  for (const exc of excerpts) {
    const cids = exc.conceptIds;
    for (let i = 0; i < cids.length; i++) {
      for (let j = i + 1; j < cids.length; j++) {
        const k = linkKey(cids[i], cids[j]);
        if (!linkMap.has(k)) linkMap.set(k, { source: cids[i], target: cids[j], weight: 0 });
        linkMap.get(k).weight++;
      }
    }
  }

  const links = [...linkMap.values()];

  return { nodes, links };
}

// ── Estadísticas ────────────────────────────────────────────────────────────

export function getStats() {
  return {
    sources: Object.keys(state.sources).length,
    excerpts: Object.keys(state.excerpts).length,
    concepts: Object.keys(state.concepts).length,
    themes: Object.keys(state.themes).length,
    notes: Object.keys(state.notes).length,
  };
}
