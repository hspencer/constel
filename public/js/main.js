// main.js — punto de entrada de con§tel
// Conecta state, router, tabs y componentes.

import { state, loadState, subscribe, getStats } from "./state.js";
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
  // 0. i18n — translate static UI
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

  // 7. Export / Import
  initExportImport();

  // 7. Suscribirse a cambios para status
  subscribe(() => {
    const s = getStats();
    showStatus(`${s.sources} fuentes · ${s.excerpts} § · ${s.concepts} conceptos`);
  });

  // status inicial
  const s = getStats();
  const suffix = isStaticMode() ? " (demo)" : "";
  showStatus(`${s.sources} fuentes · ${s.excerpts} § · ${s.concepts} conceptos${suffix}`);

  // en modo estático, indicar visualmente
  if (isStaticMode()) {
    document.getElementById("exportBtn")?.setAttribute("title", "Exportar constelación (ZIP) — incluye tus cambios locales");
    document.querySelector(".import-label")?.setAttribute("title", "Importar constelación (ZIP) — reemplaza datos locales");
  }

  console.log(`con§tel iniciado${suffix}`);
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

// ── Go ──────────────────────────────────────────────────────────────────────

boot().catch(err => {
  console.error("Error al iniciar con§tel:", err);
  showStatus("Error al iniciar");
});
