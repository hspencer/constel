// con§tel — servidor
// Sirve archivos estáticos, persiste estado en JSON, lee corpus de textos.

import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";

// ── .env ────────────────────────────────────────────────────────────────────

function loadDotEnv(filePath) {
  let raw = "";
  try { raw = readFileSync(filePath, "utf8"); } catch { return; }
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadDotEnv(path.join(process.cwd(), ".env"));

// ── Configuración ───────────────────────────────────────────────────────────

const PORT    = Number(process.env.PORT || 8787);
const HOST    = process.env.HOST || "127.0.0.1";
const ROOT    = process.cwd();
const PUBLIC  = path.join(ROOT, "public");
const CORPUS  = path.join(ROOT, "corpus");
const DATA    = path.join(ROOT, "data");
const DB_PATH = path.join(DATA, "constel-db.json");
const VER_DIR = path.join(DATA, "versions");
const SES_PATH = path.join(DATA, "session-id.txt");
const SNAPSHOT_INTERVAL = Number(process.env.SNAPSHOT_INTERVAL_MS || 10 * 60 * 1000);

let lastSnapshotAt = 0;
let lastSnapshotHash = "";

// ── Utilidades ──────────────────────────────────────────────────────────────

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt":  "text/plain; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".ico":  "image/x-icon",
};

function sendJson(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    "Content-Type": MIME[".json"],
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, code, text) {
  res.writeHead(code, { "Content-Type": MIME[".txt"] });
  res.end(text);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function newSessionId() {
  return `s-${timestamp()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Encoding inteligente para textos del corpus ─────────────────────────────

function mojibakeScore(text) {
  if (!text) return 0;
  let score = 0;
  for (const p of [/Ã./g, /Â./g, /â€/g, /\uFFFD/g]) {
    const m = text.match(p);
    if (m) score += m.length * 3;
  }
  const ctrl = text.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g);
  if (ctrl) score += ctrl.length * 5;
  return score;
}

function attemptUtf8Repair(val) {
  try {
    const bytes = new Uint8Array(val.length);
    for (let i = 0; i < val.length; i++) bytes[i] = val.charCodeAt(i) & 0xff;
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch { return val; }
}

function decodeBufferSmart(buf) {
  const candidates = [];
  try { candidates.push(buf.toString("utf8")); } catch {}
  try { candidates.push(new TextDecoder("windows-1252", { fatal: false }).decode(buf)); } catch {}
  try { candidates.push(buf.toString("latin1")); } catch {}
  if (!candidates.length) return "";

  const expanded = [];
  for (const c of candidates) { expanded.push(c); expanded.push(attemptUtf8Repair(c)); }

  let best = expanded[0], bestScore = mojibakeScore(best);
  for (const c of expanded.slice(1)) {
    const s = mojibakeScore(c);
    if (s < bestScore) { best = c; bestScore = s; }
  }
  return (best || "").normalize("NFC")
    .replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    .replace(/\u2028|\u2029/g, "\n").trim();
}

async function readTextSmart(filePath) {
  return decodeBufferSmart(await fs.readFile(filePath));
}

// ── Frontmatter YAML simple ──────────────────────────────────────────────────

function parseFrontmatter(raw) {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const yamlBlock = match[1];
  const body = match[2].trim();
  const meta = {};
  for (const line of yamlBlock.split('\n')) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    let val = line.slice(colon + 1).trim();
    // quitar comillas envolventes
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    meta[key] = val;
  }
  return { meta, body };
}

// ── Base de datos ───────────────────────────────────────────────────────────

function defaultDb() {
  return {
    version: 1,
    updatedAt: null,
    sessionId: "",
    sources: {},
    excerpts: {},
    concepts: {},
    themes: {},
    notes: {},
  };
}

async function ensureDirs() {
  await fs.mkdir(DATA, { recursive: true });
  await fs.mkdir(VER_DIR, { recursive: true });
}

async function readDb() {
  try {
    const raw = await fs.readFile(DB_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {}
  // intentar recuperar del último snapshot
  try {
    const files = (await fs.readdir(VER_DIR)).filter(f => f.endsWith(".json")).sort().reverse();
    for (const f of files) {
      try {
        const raw = await fs.readFile(path.join(VER_DIR, f), "utf8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") return parsed;
      } catch {}
    }
  } catch {}
  return defaultDb();
}

async function writeDb(data) {
  await ensureDirs();
  const json = JSON.stringify(data, null, 2);
  const tmp = DB_PATH + ".tmp";
  await fs.writeFile(tmp, json, "utf8");
  await fs.rename(tmp, DB_PATH);
  // auto-snapshot si corresponde
  const now = Date.now();
  const h = hashString(json);
  if (h !== lastSnapshotHash && now - lastSnapshotAt > SNAPSHOT_INTERVAL) {
    const snapFile = path.join(VER_DIR, `constel-${timestamp()}.json`);
    await fs.writeFile(snapFile, json, "utf8");
    lastSnapshotAt = now;
    lastSnapshotHash = h;
  }
}

async function readSessionId() {
  try { return (await fs.readFile(SES_PATH, "utf8")).trim() || ""; } catch { return ""; }
}

async function writeSessionId(id) {
  await ensureDirs();
  await fs.writeFile(SES_PATH, id + "\n", "utf8");
}

// ── API routes ──────────────────────────────────────────────────────────────

async function handleApi(req, res, pathname) {
  // GET /api/health
  if (pathname === "/api/health" && req.method === "GET") {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
    return sendJson(res, 200, {
      ok: true,
      version: pkg.version,
      sessionId: await readSessionId(),
      dbPath: DB_PATH,
    });
  }

  // GET /api/db
  if (pathname === "/api/db" && req.method === "GET") {
    const db = await readDb();
    return sendJson(res, 200, db);
  }

  // PUT /api/db
  if (pathname === "/api/db" && req.method === "PUT") {
    const body = await readBody(req);
    const data = JSON.parse(body);
    data.updatedAt = new Date().toISOString();
    await writeDb(data);
    return sendJson(res, 200, { ok: true, updatedAt: data.updatedAt });
  }

  // POST /api/db/new-session
  if (pathname === "/api/db/new-session" && req.method === "POST") {
    // archivar sesión actual
    const current = await readDb();
    const snapFile = path.join(VER_DIR, `constel-archive-${timestamp()}.json`);
    await fs.writeFile(snapFile, JSON.stringify(current, null, 2), "utf8");
    // crear nueva sesión
    const sid = newSessionId();
    await writeSessionId(sid);
    const fresh = defaultDb();
    fresh.sessionId = sid;
    await writeDb(fresh);
    return sendJson(res, 200, { ok: true, sessionId: sid });
  }

  // GET /api/corpus — listar archivos .txt y .md
  if (pathname === "/api/corpus" && req.method === "GET") {
    try {
      const entries = await fs.readdir(CORPUS, { withFileTypes: true });
      const files = [];
      for (const e of entries) {
        if (!e.isFile()) continue;
        if (!e.name.endsWith(".txt") && !e.name.endsWith(".md")) continue;
        const stat = await fs.stat(path.join(CORPUS, e.name));
        files.push({ filename: e.name, size: stat.size });
      }
      files.sort((a, b) => a.filename.localeCompare(b.filename));
      return sendJson(res, 200, { files });
    } catch {
      return sendJson(res, 200, { files: [] });
    }
  }

  // PUT /api/corpus/rename — renombrar archivo del corpus
  if (pathname === "/api/corpus/rename" && req.method === "PUT") {
    const body = await readBody(req);
    const { oldName, newName } = JSON.parse(body);
    if (!oldName || !newName || oldName.includes("..") || newName.includes("..") ||
        oldName.includes("/") || newName.includes("/")) {
      return sendJson(res, 400, { error: "nombre de archivo inválido" });
    }
    const oldPath = path.join(CORPUS, oldName);
    const newPath = path.join(CORPUS, newName);
    try {
      await fs.access(oldPath);
      try { await fs.access(newPath); return sendJson(res, 409, { error: "ya existe un archivo con ese nombre" }); } catch {}
      await fs.rename(oldPath, newPath);
      return sendJson(res, 200, { ok: true, oldName, newName });
    } catch {
      return sendJson(res, 404, { error: "archivo no encontrado" });
    }
  }

  // GET /api/corpus/:filename — leer un texto (con parsing de frontmatter)
  if (pathname.startsWith("/api/corpus/") && req.method === "GET") {
    const filename = decodeURIComponent(pathname.slice("/api/corpus/".length));
    if (filename.includes("..") || filename.includes("/")) {
      return sendJson(res, 400, { error: "nombre de archivo inválido" });
    }
    const filePath = path.join(CORPUS, filename);
    try {
      const raw = await readTextSmart(filePath);
      const { meta, body } = parseFrontmatter(raw);
      return sendJson(res, 200, { filename, text: body, meta, length: body.length });
    } catch {
      return sendJson(res, 404, { error: "archivo no encontrado" });
    }
  }

  // GET /api/export/csv
  if (pathname === "/api/export/csv" && req.method === "GET") {
    const db = await readDb();
    const lines = ["source_id,source_title,excerpt_id,excerpt_text,concept_label,theme_label"];
    for (const exc of Object.values(db.excerpts || {})) {
      const src = (db.sources || {})[exc.sourceId] || {};
      for (const cid of (exc.conceptIds || [])) {
        const con = (db.concepts || {})[cid] || {};
        const thm = con.themeId ? ((db.themes || {})[con.themeId] || {}) : {};
        const row = [
          exc.sourceId,
          (src.title || "").replace(/"/g, '""'),
          exc.id,
          (exc.text || "").replace(/"/g, '""').replace(/\n/g, " "),
          (con.label || "").replace(/"/g, '""'),
          (thm.label || "").replace(/"/g, '""'),
        ].map(v => `"${v}"`).join(",");
        lines.push(row);
      }
    }
    const csv = lines.join("\n");
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="constel-export-${timestamp()}.csv"`,
    });
    return res.end(csv);
  }

  // POST /api/import — recibir un ZIP con corpus + db
  if (pathname === "/api/import" && req.method === "POST") {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));

      // body.db = JSON object de constel-db.json
      // body.files = [{ filename, content }] textos del corpus
      if (body.db) {
        await writeDb(body.db);
      }
      if (body.files && Array.isArray(body.files)) {
        for (const f of body.files) {
          if (!f.filename || f.filename.includes("..") || f.filename.includes("/")) continue;
          await fs.writeFile(path.join(CORPUS, f.filename), f.content, "utf8");
        }
      }
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  return sendJson(res, 404, { error: "endpoint no encontrado" });
}

// ── Servir archivos estáticos ───────────────────────────────────────────────

async function serveStatic(res, pathname) {
  let filePath = path.join(PUBLIC, pathname === "/" ? "index.html" : pathname);
  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, "index.html");
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || "application/octet-stream";
    const content = await fs.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": mime,
      "Content-Length": content.length,
    });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": MIME[".txt"] });
    res.end("404 — no encontrado");
  }
}

// ── Servidor ────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);

  // CORS para desarrollo local
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  try {
    if (pathname.startsWith("/api/")) {
      await handleApi(req, res, pathname);
    } else {
      await serveStatic(res, pathname);
    }
  } catch (err) {
    console.error(`Error ${req.method} ${pathname}:`, err.message);
    sendJson(res, 500, { error: err.message });
  }
});

await ensureDirs();

// Inicializar sesión si no existe
let sessionId = await readSessionId();
if (!sessionId) {
  sessionId = newSessionId();
  await writeSessionId(sessionId);
}

server.listen(PORT, HOST, () => {
  console.log(`\n  con§tel — http://${HOST}:${PORT}\n`);
  console.log(`  corpus:  ${CORPUS}`);
  console.log(`  data:    ${DATA}`);
  console.log(`  sesión:  ${sessionId}\n`);
});
