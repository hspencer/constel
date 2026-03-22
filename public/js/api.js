// api.js — comunicación con el servidor

const BASE = "";

async function request(method, path, body) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  // CSV viene como texto
  if (res.headers.get("Content-Type")?.includes("text/csv")) {
    return res.text();
  }
  return res.json();
}

export const api = {
  getDb:        ()       => request("GET", "/api/db"),
  putDb:        (data)   => request("PUT", "/api/db", data),
  newSession:   ()       => request("POST", "/api/db/new-session"),
  listCorpus:   ()       => request("GET", "/api/corpus"),
  readSource:   (name)   => request("GET", `/api/corpus/${encodeURIComponent(name)}`),
  renameSource: (oldName, newName) => request("PUT", "/api/corpus/rename", { oldName, newName }),
  exportCsv:    ()       => request("GET", "/api/export/csv"),
  health:       ()       => request("GET", "/api/health"),
};
