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

// ── Go ──────────────────────────────────────────────────────────────────────

boot().catch(err => {
  console.error("Error al iniciar con§tel:", err);
  showStatus("Error al iniciar");
});
