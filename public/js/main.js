// main.js — punto de entrada de con§tel
// Conecta state, router, tabs y componentes.

import { state, loadState, subscribe, getStats, notify } from "./state.js";
import { api, isStaticMode } from "./api.js";
import { initRouter, onTabChange } from "./router.js";
import { getSourceText } from "./tabs/sources.js";
import { initSplitViews } from "./components/split-view.js";
import { initSourcesTab, onSourcesActivated } from "./tabs/sources.js";
import { initReaderTab, onReaderActivated } from "./tabs/reader.js";
import { initThemesTab, onThemesActivated } from "./tabs/themes.js";
import { applyTranslations, t } from "./i18n.js";

// ── Arranque ────────────────────────────────────────────────────────────────

async function boot() {
  // 0. Version + i18n
  applyTranslations();

  showStatus(t("reader.loading"));

  // 1. Cargar estado
  await loadState();

  // 2. Inicializar split views
  initSplitViews();

  // 3. Inicializar tabs
  await initSourcesTab();
  initReaderTab();
  initThemesTab();

  // 4. Registrar callbacks de navegación
  onTabChange("sources", onSourcesActivated);
  onTabChange("reader", onReaderActivated);
  onTabChange("themes", onThemesActivated);

  // 5. Inicializar router (aplica ruta actual)
  initRouter();

  // 6. Toggle tema claro/oscuro
  initThemeToggle();

  // 7. Export / Import / Merge
  initExportImport();
  initMerge();

  // 7. Suscribirse a cambios para status
  subscribe(() => {
    const s = getStats();
    showStatus(`${s.sources} fuentes · ${s.excerpts} § · ${s.concepts} conceptos`);
  });

  // status inicial
  const s = getStats();
  showStatus(`${s.sources} fuentes · ${s.excerpts} § · ${s.concepts} conceptos`);

  // Version: health endpoint → fallback to version.json
  try {
    const health = await fetch("/api/health").then(r => r.ok ? r.json() : null).catch(() => null);
    let ver = health?.version;
    if (!ver) {
      const vf = await fetch("version.json").then(r => r.ok ? r.json() : null).catch(() => null);
      ver = vf?.version;
    }
    if (ver) {
      const v = document.getElementById("appVersion");
      if (v) v.textContent = "v" + ver;
    }
  } catch {}

  // en modo estático, mostrar indicador con tooltip
  if (isStaticMode()) {
    showStaticModeIndicator();
    document.getElementById("exportBtn")?.setAttribute("title", "Exportar constelación (ZIP) — incluye tus cambios locales");
    document.querySelector(".import-label")?.setAttribute("title", "Importar constelación (ZIP) — reemplaza datos locales");
  }

  console.log(`con§tel iniciado${isStaticMode() ? " (modo estático)" : ""}`);
}

// ── Theme toggle ────────────────────────────────────────────────────────────

function initThemeToggle() {
  const btn = document.getElementById("themeToggle");
  const html = document.documentElement;

  // restaurar preferencia
  const saved = localStorage.getItem("constel-theme");
  if (saved) html.dataset.theme = saved;
  else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
    html.dataset.theme = "dark";
  }

  btn?.addEventListener("click", () => {
    const next = html.dataset.theme === "dark" ? "light" : "dark";
    html.dataset.theme = next;
    localStorage.setItem("constel-theme", next);
  });
}

// ── Status ──────────────────────────────────────────────────────────────────

function showStatus(msg) {
  const el = document.getElementById("statusMsg");
  if (el) el.textContent = msg;
}

function showStaticModeIndicator() {
  const statusEl = document.getElementById("statusMsg");
  if (!statusEl) return;
  const hint = document.createElement("span");
  hint.className = "static-mode-hint";
  hint.textContent = "?";
  hint.title = "Modo estático: no hay servidor conectado.\nLos cambios se guardan solo en este navegador (localStorage).\nUsa Exportar (ZIP) para llevarte tu trabajo.";
  statusEl.appendChild(hint);
}

// ── Export / Import ─────────────────────────────────────────────────────────

function showImportConfirm() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal" style="max-width: 400px">
        <h3 style="margin-bottom: var(--space-sm)">Importar constelación</h3>
        <p style="font-size: var(--font-size-sm); color: var(--muted); margin-bottom: var(--space-md)">
          Importar reemplazará todos los textos y datos actuales.
        </p>
        <div style="display: flex; gap: var(--space-sm); justify-content: flex-end; flex-wrap: wrap">
          <button class="btn-sm" data-action="cancel">Cancelar</button>
          <button class="btn-sm" data-action="backup-then-import" style="color: var(--accent)">Respaldar e importar</button>
          <button class="btn-primary btn-sm" data-action="import">Importar directamente</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener("click", (e) => {
      const action = e.target.dataset.action;
      if (action) {
        overlay.remove();
        resolve(action);
      } else if (e.target === overlay) {
        overlay.remove();
        resolve("cancel");
      }
    });
  });
}

function initExportImport() {
  // Dropdown toggle
  const dropdown = document.getElementById("bibliotecaDropdown");
  const menuBtn = document.getElementById("bibliotecaBtn");
  menuBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdown.classList.toggle("open");
  });
  document.addEventListener("click", () => dropdown?.classList.remove("open"));

  const exportBtn = document.getElementById("exportBtn");
  const importInput = document.getElementById("importFile");

  exportBtn?.addEventListener("click", async () => {
    showStatus("Exportando...");
    try {
      const JSZip = window.JSZip;
      if (!JSZip) { alert("JSZip no cargado"); return; }

      const zip = new JSZip();

      // 1. DB — siempre desde el state en memoria (más reciente)
      zip.file("constel-db.json", JSON.stringify(state, null, 2));

      // 2. Corpus — cargar cada texto
      for (const src of Object.values(state.sources)) {
        const text = await getSourceText(src.id);
        if (text) {
          zip.file(`corpus/${src.filename}`, text);
        }
      }

      // 3. Generate and download
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `constel-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);

      showStatus("Exportación completada");
    } catch (err) {
      console.error("Export error:", err);
      showStatus("Error al exportar");
    }
  });

  importInput?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const action = await showImportConfirm();
    if (action === "cancel") {
      importInput.value = "";
      return;
    }
    if (action === "backup-then-import") {
      // exportar primero
      exportBtn.click();
      // esperar un momento para que el download arranque
      await new Promise(r => setTimeout(r, 1000));
    }

    showStatus("Importando...");
    try {
      const JSZip = window.JSZip;
      if (!JSZip) { alert("JSZip no cargado"); return; }

      const zip = await JSZip.loadAsync(file);

      // 1. Extract DB
      let db = null;
      const dbFile = zip.file("constel-db.json");
      if (dbFile) {
        const dbText = await dbFile.async("string");
        db = JSON.parse(dbText);
      }

      // 2. Extract corpus files
      const textFiles = [];
      zip.folder("corpus")?.forEach((relativePath, zipEntry) => {
        if (!zipEntry.dir) {
          textFiles.push({ name: relativePath, entry: zipEntry });
        }
      });

      const files = [];
      for (const cf of textFiles) {
        const content = await cf.entry.async("string");
        files.push({ filename: cf.name, content });
      }

      // 3. Aplicar DB al state + localStorage
      if (db) {
        Object.assign(state, db);
        try { localStorage.setItem("constel-state", JSON.stringify(state)); } catch {}
      }

      // 4. Guardar textos en el text cache (para modo estático)
      //    y en localStorage como respaldo
      const textCacheData = {};
      for (const f of files) {
        textCacheData[f.filename] = f.content;
      }
      try { localStorage.setItem("constel-corpus", JSON.stringify(textCacheData)); } catch {}

      // 5. Si hay servidor, también enviar allá
      if (!isStaticMode()) {
        try {
          await fetch("/api/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ db, files }),
          });
        } catch {}
      }

      importInput.value = "";
      showStatus("Importación completada — recargando...");
      setTimeout(() => location.reload(), 500);
    } catch (err) {
      console.error("Import error:", err);
      showStatus("Error al importar");
      importInput.value = "";
    }
  });
}

// ── Merge / Concatenar biblioteca ────────────────────────────────────────────

function initMerge() {
  const mergeInput = document.getElementById("mergeFile");
  mergeInput?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    showStatus("Concatenando...");
    try {
      const JSZip = window.JSZip;
      if (!JSZip) { alert("JSZip no cargado"); return; }

      const zip = await JSZip.loadAsync(file);

      // 1. Extract incoming DB
      let incoming = null;
      const dbFile = zip.file("constel-db.json");
      if (dbFile) {
        incoming = JSON.parse(await dbFile.async("string"));
      }
      if (!incoming) {
        showStatus("ZIP sin constel-db.json");
        mergeInput.value = "";
        return;
      }

      // 2. Extract corpus files
      const incomingTexts = {};
      const corpusFolder = zip.folder("corpus");
      if (corpusFolder) {
        const entries = [];
        corpusFolder.forEach((path, entry) => { if (!entry.dir) entries.push({ path, entry }); });
        for (const { path, entry } of entries) {
          incomingTexts[path] = await entry.async("string");
        }
      }

      // ── Merge logic ──

      // Build lookup of existing sources by filename
      const existingByFilename = new Map();
      for (const src of Object.values(state.sources)) {
        existingByFilename.set(src.filename, src);
      }

      // Build lookup of existing concepts by label (case-insensitive)
      const existingConceptByLabel = new Map();
      for (const c of Object.values(state.concepts)) {
        existingConceptByLabel.set(c.label.toLowerCase(), c);
      }

      // Build lookup of existing themes by label
      const existingThemeByLabel = new Map();
      for (const t of Object.values(state.themes)) {
        existingThemeByLabel.set(t.label.toLowerCase(), t);
      }

      // ID remapping: incoming ID → local ID
      const sourceIdMap = new Map();   // incoming srcId → local srcId
      const conceptIdMap = new Map();  // incoming conId → local conId
      const themeIdMap = new Map();    // incoming themeId → local themeId

      let addedSources = 0, addedExcerpts = 0, addedConcepts = 0, addedThemes = 0;

      // 3. Merge themes
      for (const [id, theme] of Object.entries(incoming.themes || {})) {
        const existing = existingThemeByLabel.get(theme.label.toLowerCase());
        if (existing) {
          themeIdMap.set(id, existing.id);
        } else {
          const newId = `thm_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
          state.themes[newId] = { ...theme, id: newId };
          themeIdMap.set(id, newId);
          existingThemeByLabel.set(theme.label.toLowerCase(), state.themes[newId]);
          addedThemes++;
        }
      }

      // 4. Merge concepts (remap themeId)
      for (const [id, concept] of Object.entries(incoming.concepts || {})) {
        const existing = existingConceptByLabel.get(concept.label.toLowerCase());
        if (existing) {
          conceptIdMap.set(id, existing.id);
          // If incoming has a theme assignment and local doesn't, adopt it
          if (concept.themeId && !existing.themeId) {
            existing.themeId = themeIdMap.get(concept.themeId) || null;
          }
        } else {
          const newId = `con_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
          state.concepts[newId] = {
            ...concept,
            id: newId,
            themeId: concept.themeId ? (themeIdMap.get(concept.themeId) || null) : null,
          };
          conceptIdMap.set(id, newId);
          existingConceptByLabel.set(concept.label.toLowerCase(), state.concepts[newId]);
          addedConcepts++;
        }
      }

      // 5. Merge sources + their texts
      for (const [id, src] of Object.entries(incoming.sources || {})) {
        const existing = existingByFilename.get(src.filename);
        if (existing) {
          sourceIdMap.set(id, existing.id);
        } else {
          const newId = `src_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
          state.sources[newId] = { ...src, id: newId };
          sourceIdMap.set(id, newId);
          existingByFilename.set(src.filename, state.sources[newId]);
          addedSources++;

          // Store text in localStorage corpus cache
          if (incomingTexts[src.filename]) {
            try {
              const cache = JSON.parse(localStorage.getItem("constel-corpus") || "{}");
              cache[src.filename] = incomingTexts[src.filename];
              localStorage.setItem("constel-corpus", JSON.stringify(cache));
            } catch {}
          }
        }
      }

      // 6. Merge excerpts (skip duplicates by sourceId + start + end)
      const existingExcerptKeys = new Set();
      for (const exc of Object.values(state.excerpts)) {
        existingExcerptKeys.add(`${exc.sourceId}:${exc.start}:${exc.end}`);
      }

      for (const [, exc] of Object.entries(incoming.excerpts || {})) {
        // Strict remap: incoming IDs are never trusted directly
        const localSourceId = sourceIdMap.get(exc.sourceId);
        if (!localSourceId) continue; // source not mapped → skip

        const key = `${localSourceId}:${exc.start}:${exc.end}`;
        if (existingExcerptKeys.has(key)) continue;

        const newId = `exc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const remappedConceptIds = (exc.conceptIds || [])
          .map(cid => conceptIdMap.get(cid))
          .filter(Boolean); // only keep successfully remapped concepts

        state.excerpts[newId] = {
          ...exc,
          id: newId,
          sourceId: localSourceId,
          conceptIds: remappedConceptIds,
        };
        existingExcerptKeys.add(key);
        addedExcerpts++;
      }

      // 7. Merge notes
      let addedNotes = 0;
      const existingNoteKeys = new Set();
      for (const n of Object.values(state.notes || {})) {
        existingNoteKeys.add(`${n.themeId}:${n.text?.slice(0, 50)}`);
      }
      for (const [, note] of Object.entries(incoming.notes || {})) {
        const localThemeId = themeIdMap.get(note.themeId);
        if (!localThemeId) continue; // theme not mapped → skip

        const key = `${localThemeId}:${note.text?.slice(0, 50)}`;
        if (existingNoteKeys.has(key)) continue;

        const newId = `note_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        state.notes[newId] = { ...note, id: newId, themeId: localThemeId };
        addedNotes++;
      }

      // 8. Upload new texts to server if available
      if (!isStaticMode()) {
        const newFiles = [];
        for (const [inId, src] of Object.entries(incoming.sources || {})) {
          if (!existingByFilename.has(src.filename) || sourceIdMap.get(inId) !== inId) {
            // was new
            if (incomingTexts[src.filename]) {
              newFiles.push({ filename: src.filename, content: incomingTexts[src.filename] });
            }
          }
        }
        if (newFiles.length) {
          try {
            await fetch("/api/import", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ db: state, files: newFiles }),
            });
          } catch {}
        } else {
          // Just save the updated DB
          try { await api.putDb(state); } catch {}
        }
      }

      // 9. Persist and reload
      notify();
      mergeInput.value = "";

      const summary = [];
      if (addedSources) summary.push(`${addedSources} fuentes`);
      if (addedExcerpts) summary.push(`${addedExcerpts} §`);
      if (addedConcepts) summary.push(`${addedConcepts} conceptos`);
      if (addedThemes) summary.push(`${addedThemes} temas`);

      if (summary.length) {
        showStatus(`Concatenado: +${summary.join(", ")}`);
        setTimeout(() => location.reload(), 1500);
      } else {
        showStatus("Sin datos nuevos — todo ya existía");
      }

    } catch (err) {
      console.error("Merge error:", err);
      showStatus("Error al concatenar");
      mergeInput.value = "";
    }
  });
}

// ── Go ──────────────────────────────────────────────────────────────────────

boot().catch(err => {
  console.error("Error al iniciar con§tel:", err);
  showStatus("Error al iniciar");
});
