// main.js — punto de entrada de con§tel
// Conecta state, router, tabs y componentes.

import { loadState, subscribe, getStats } from "./state.js";
import { initRouter, onTabChange } from "./router.js";
import { initSplitViews } from "./components/split-view.js";
import { initSourcesTab, onSourcesActivated } from "./tabs/sources.js";
import { initReaderTab, onReaderActivated } from "./tabs/reader.js";
import { initThemesTab, onThemesActivated } from "./tabs/themes.js";

// ── Arranque ────────────────────────────────────────────────────────────────

async function boot() {
  showStatus("Cargando...");

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
  showStatus(`${s.sources} fuentes · ${s.excerpts} § · ${s.concepts} conceptos`);

  console.log("con§tel iniciado");
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

function initExportImport() {
  const exportBtn = document.getElementById("exportBtn");
  const importInput = document.getElementById("importFile");

  exportBtn?.addEventListener("click", async () => {
    showStatus("Exportando...");
    try {
      const JSZip = window.JSZip;
      if (!JSZip) { alert("JSZip no cargado"); return; }

      const zip = new JSZip();

      // 1. DB
      const dbRes = await fetch("/api/db");
      const db = await dbRes.json();
      zip.file("constel-db.json", JSON.stringify(db, null, 2));

      // 2. Corpus files
      const corpusRes = await fetch("/api/corpus");
      const { files } = await corpusRes.json();
      for (const f of files) {
        const textRes = await fetch(`/api/corpus/${encodeURIComponent(f.filename)}`);
        const data = await textRes.json();
        zip.file(`corpus/${f.filename}`, data.text || "");
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

    if (!confirm("Importar reemplazará todos los textos y datos actuales. ¿Continuar?")) {
      importInput.value = "";
      return;
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
      const corpusFiles = [];
      zip.folder("corpus")?.forEach((relativePath, zipEntry) => {
        if (!zipEntry.dir) {
          corpusFiles.push({ name: relativePath, entry: zipEntry });
        }
      });

      const files = [];
      for (const cf of corpusFiles) {
        const content = await cf.entry.async("string");
        files.push({ filename: cf.name, content });
      }

      // 3. Send to server
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ db, files }),
      });

      if (!res.ok) throw new Error("Server error");

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
