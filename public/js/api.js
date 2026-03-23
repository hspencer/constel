// api.js — comunicación con el servidor (o modo estático para GitHub Pages)

const BASE = "";

// Detectar si hay servidor disponible
let _serverAvailable = null;

async function checkServer() {
  if (_serverAvailable !== null) return _serverAvailable;
  try {
    const res = await fetch("/api/health", { signal: AbortSignal.timeout(2000) });
    _serverAvailable = res.ok;
  } catch {
    _serverAvailable = false;
  }
  return _serverAvailable;
}

export function isStaticMode() {
  return _serverAvailable === false;
}

async function request(method, path, body) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  if (res.headers.get("Content-Type")?.includes("text/csv")) {
    return res.text();
  }
  return res.json();
}

// ── API estática (GitHub Pages) ─────────────────────────────────────────────

const staticApi = {
  async getDb() {
    const res = await fetch("constel-db.json");
    return res.json();
  },

  async putDb() {
    console.warn("Modo demo: los cambios no se guardan en el servidor");
    return { ok: true };
  },

  async listCorpus() {
    // En modo estático, leemos los filenames de la DB
    const db = await this.getDb();
    const files = Object.values(db.sources || {}).map(s => ({
      filename: s.filename,
      size: 0,
    }));
    return { files };
  },

  async readSource(name) {
    const res = await fetch(`corpus/${encodeURIComponent(name)}`);
    if (!res.ok) throw new Error("Not found");
    const text = await res.text();
    return { filename: name, text, meta: {}, length: text.length };
  },

  async renameSource() {
    console.warn("Modo demo: no se puede renombrar");
    return { ok: false };
  },

  async newSession() {
    console.warn("Modo demo: no se puede crear sesión");
    return { ok: false };
  },

  async exportCsv() {
    console.warn("Modo demo: export CSV no disponible");
    return "";
  },

  async health() {
    return { ok: true, static: true };
  },
};

// ── API con servidor ────────────────────────────────────────────────────────

const serverApi = {
  getDb:        ()       => request("GET", "/api/db"),
  putDb:        (data)   => request("PUT", "/api/db", data),
  newSession:   ()       => request("POST", "/api/db/new-session"),
  listCorpus:   ()       => request("GET", "/api/corpus"),
  readSource:   (name)   => request("GET", `/api/corpus/${encodeURIComponent(name)}`),
  renameSource: (oldName, newName) => request("PUT", "/api/corpus/rename", { oldName, newName }),
  exportCsv:    ()       => request("GET", "/api/export/csv"),
  health:       ()       => request("GET", "/api/health"),
};

// ── Proxy que elige automáticamente ─────────────────────────────────────────

export const api = new Proxy({}, {
  get(_, prop) {
    return async (...args) => {
      const hasServer = await checkServer();
      const impl = hasServer ? serverApi : staticApi;
      if (typeof impl[prop] === "function") {
        return impl[prop](...args);
      }
      throw new Error(`API method ${prop} not found`);
    };
  },
});
