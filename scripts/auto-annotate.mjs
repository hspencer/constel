#!/usr/bin/env node
/**
 * auto-annotate.mjs
 *
 * Two-step interactive annotation using Claude CLI:
 *   STEP 1 — Claude proposes concepts for the document
 *            → you review, remove, add concepts
 *   STEP 2 — Claude marks excerpt boundaries using anchors (first/last words)
 *            → the script extracts exact text from the source file (zero offset errors)
 *
 * Usage:
 *   node scripts/auto-annotate.mjs "1983 - América, Américas Mías.txt"
 *   node scripts/auto-annotate.mjs "1983 - América, Américas Mías.txt" --dry-run
 */

import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { createInterface } from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DB_PATH = join(ROOT, 'data', 'constel-db.json');
const CORPUS_DIR = join(ROOT, 'corpus');

// ── Helpers ──────────────────────────────────────────────────────────

function makeId(prefix) {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${ts}${rand}`;
}

function now() {
  return new Date().toISOString();
}

function askQuestion(rl, prompt) {
  return new Promise(resolve => rl.question(prompt, resolve));
}

/**
 * Split text into numbered paragraphs for Claude to reference.
 * A paragraph = non-empty block separated by blank lines or indentation changes.
 */
function numberParagraphs(text) {
  const lines = text.split('\n');
  const paragraphs = [];
  let current = [];
  let startOffset = 0;
  let currentStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = startOffset;
    startOffset += line.length + 1; // +1 for \n

    if (line.trim() === '') {
      if (current.length > 0) {
        paragraphs.push({
          num: paragraphs.length + 1,
          text: current.join('\n'),
          start: currentStart,
          end: lineStart, // up to the blank line
        });
        current = [];
      }
    } else {
      if (current.length === 0) currentStart = lineStart;
      current.push(line);
    }
  }
  if (current.length > 0) {
    paragraphs.push({
      num: paragraphs.length + 1,
      text: current.join('\n'),
      start: currentStart,
      end: startOffset,
    });
  }

  return paragraphs;
}

/**
 * Resolve an anchor string to a position in the text.
 * Tries exact match first, then normalized whitespace.
 * Returns the index of the first character, or -1.
 */
function findAnchor(text, anchor, searchFrom = 0) {
  if (!anchor || anchor.length < 3) return -1;

  const region = text.slice(searchFrom);

  // Exact match
  let idx = region.indexOf(anchor);
  if (idx !== -1) return searchFrom + idx;

  // Normalized whitespace match
  const normRegion = region.replace(/\s+/g, ' ');
  const normAnchor = anchor.replace(/\s+/g, ' ');
  const normIdx = normRegion.indexOf(normAnchor);
  if (normIdx !== -1) {
    // Map back to original position
    let origPos = 0, normPos = 0;
    while (normPos < normIdx && origPos < region.length) {
      if (/\s/.test(region[origPos])) {
        while (origPos < region.length - 1 && /\s/.test(region[origPos + 1])) origPos++;
      }
      origPos++;
      normPos++;
    }
    return searchFrom + origPos;
  }

  return -1;
}

/**
 * Given start_anchor and end_anchor, find the exact excerpt in the source text.
 * Returns { start, end, text } or null.
 */
function resolveAnchors(fullText, startAnchor, endAnchor, searchFrom = 0) {
  const startIdx = findAnchor(fullText, startAnchor, searchFrom);
  if (startIdx === -1) return null;

  // Find end anchor starting from where start anchor was found
  const endIdx = findAnchor(fullText, endAnchor, startIdx);
  if (endIdx === -1) return null;

  // End position = end of the end_anchor string
  // Find exact length of end anchor in original text
  const endRegion = fullText.slice(endIdx);
  const normEnd = endRegion.replace(/\s+/g, ' ');
  const normAnchor = endAnchor.replace(/\s+/g, ' ');

  let endPos = endIdx;
  if (endRegion.startsWith(endAnchor)) {
    endPos = endIdx + endAnchor.length;
  } else {
    // Walk through normalized match to find original end
    let nc = 0;
    let pos = 0;
    while (nc < normAnchor.length && pos < endRegion.length) {
      if (/\s/.test(endRegion[pos])) {
        while (pos < endRegion.length - 1 && /\s/.test(endRegion[pos + 1])) pos++;
      }
      pos++;
      nc++;
    }
    endPos = endIdx + pos;
  }

  const text = fullText.slice(startIdx, endPos);

  // Sanity: excerpt shouldn't be absurdly long (>3000 chars ~500 words)
  if (text.length > 3000) return null;

  return { start: startIdx, end: endPos, text };
}

function callClaude(prompt) {
  return execSync(
    `claude -p --output-format json --model sonnet --max-turns 1`,
    {
      input: prompt,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 300_000,
    }
  );
}

function parseJsonResponse(response) {
  const cliOutput = JSON.parse(response);
  const resultText = cliOutput.result || response;

  let jsonStr = resultText;
  const fenceMatch = resultText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) jsonStr = fenceMatch[1];

  if (!jsonStr.trim().startsWith('{') && !jsonStr.trim().startsWith('[')) {
    const objMatch = resultText.match(/\{[\s\S]*\}/);
    if (objMatch) jsonStr = objMatch[0];
  }

  return JSON.parse(jsonStr.trim());
}

// ── Main ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const filename = args.find(a => !a.startsWith('--'));

if (!filename) {
  console.error('Usage: node scripts/auto-annotate.mjs <filename> [--dry-run]');
  console.error('Example: node scripts/auto-annotate.mjs "1983 - América, Américas Mías.txt"');
  process.exit(1);
}

// Load DB & source
const db = JSON.parse(readFileSync(DB_PATH, 'utf-8'));

const source = Object.values(db.sources).find(s => s.filename === filename);
if (!source) {
  console.error(`Source not found in DB: ${filename}`);
  console.error('Available:', Object.values(db.sources).map(s => s.filename).join(', '));
  process.exit(1);
}

const textPath = join(CORPUS_DIR, filename);
let text;
try {
  text = readFileSync(textPath, 'utf-8');
} catch (e) {
  console.error(`Cannot read: ${textPath}`);
  process.exit(1);
}

const existingConcepts = Object.values(db.concepts).map(c => c.label).sort();
const existingExcerpts = Object.values(db.excerpts)
  .filter(e => e.sourceId === source.id)
  .map(e => ({ text: e.text.slice(0, 50), start: e.start, end: e.end }));

// Number paragraphs
const paragraphs = numberParagraphs(text);

console.log(`\n📄 Source: ${source.title}`);
console.log(`   ${text.length} chars, ${source.wordCount} words, ${paragraphs.length} paragraphs`);
console.log(`   ${existingExcerpts.length} existing excerpts`);
console.log(`   ${existingConcepts.length} concepts in DB`);
console.log(`   Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);

// ══════════════════════════════════════════════════════════════════════
// STEP 1 — Propose concepts
// ══════════════════════════════════════════════════════════════════════

console.log('═══ PASO 1: Análisis de conceptos ═══\n');
console.log('🤖 Enviando texto a Claude para identificar conceptos...\n');

// Build numbered text for Claude
const numberedText = paragraphs.map(p => `[§${p.num}] ${p.text}`).join('\n\n');

const step1Prompt = `Eres un asistente de análisis temático para textos poéticos y filosóficos latinoamericanos (ciclo Amereida).

## Conceptos existentes en la base de datos
${existingConcepts.map(c => `- ${c}`).join('\n')}

## Texto a analizar (con párrafos numerados §1, §2, etc.)
Filename: ${filename}

${numberedText}

## Tarea
Analiza el texto e identifica qué conceptos temáticos aparecen en él. Para cada concepto indica en qué párrafos aparece.

Devuelve un JSON con esta estructura:

\`\`\`json
{
  "existing_concepts": [
    { "label": "concepto existente", "relevance": "breve nota", "paragraphs": [1, 3, 5] }
  ],
  "new_concepts": [
    { "label": "concepto nuevo sugerido", "relevance": "breve nota", "paragraphs": [2, 4] }
  ],
  "summary": "resumen temático del texto en 2-3 oraciones"
}
\`\`\`

REGLAS:
- Solo incluye conceptos existentes que REALMENTE aparezcan en este texto.
- Los conceptos nuevos deben ser sustantivos o frases nominales cortas (2-3 palabras máx), en minúsculas, en español.
- Sugiere entre 3-10 conceptos nuevos si los existentes no cubren bien el texto.
- Responde SOLO con el JSON.`;

let step1Result;
try {
  const resp = callClaude(step1Prompt);
  step1Result = parseJsonResponse(resp);
} catch (e) {
  console.error('Error en paso 1:', e.message);
  process.exit(1);
}

// Display results
console.log(`📋 ${step1Result.summary || ''}\n`);

console.log('── Conceptos existentes detectados ──');
const detectedExisting = step1Result.existing_concepts || [];
for (let i = 0; i < detectedExisting.length; i++) {
  const c = detectedExisting[i];
  const pars = c.paragraphs ? ` (§${c.paragraphs.join(', §')})` : '';
  console.log(`  ${i + 1}. ${c.label}${pars} — ${c.relevance}`);
}

console.log('\n── Conceptos nuevos sugeridos ──');
const suggestedNew = step1Result.new_concepts || [];
for (let i = 0; i < suggestedNew.length; i++) {
  const c = suggestedNew[i];
  const pars = c.paragraphs ? ` (§${c.paragraphs.join(', §')})` : '';
  console.log(`  ${String.fromCharCode(97 + i)}. ${c.label}${pars} — ${c.relevance}`);
}

// ══════════════════════════════════════════════════════════════════════
// Interactive review
// ══════════════════════════════════════════════════════════════════════

const rl = createInterface({ input: process.stdin, output: process.stdout });

console.log('\n═══ REVISIÓN INTERACTIVA ═══');
console.log('Puedes ajustar la lista de conceptos antes de generar excerpts.\n');
console.log('Comandos:');
console.log('  -N        eliminar concepto existente (ej: -3)');
console.log('  -a        eliminar concepto nuevo sugerido (ej: -b)');
console.log('  +palabra  agregar concepto (ej: +el juego)');
console.log('  ok        continuar con la lista actual');
console.log('  abort     cancelar\n');

// Working copies
let workingExisting = detectedExisting.map(c => c.label);
let workingNew = suggestedNew.map(c => c.label);

function showCurrentList() {
  console.log('\n── Lista actual ──');
  console.log('  Existentes:', workingExisting.join(', ') || '(ninguno)');
  console.log('  Nuevos:', workingNew.join(', ') || '(ninguno)');
  console.log('');
}

showCurrentList();

let reviewing = true;
while (reviewing) {
  const input = (await askQuestion(rl, '  > ')).trim();

  if (input === 'ok' || input === '') {
    reviewing = false;
  } else if (input === 'abort') {
    console.log('\nCancelado.');
    rl.close();
    process.exit(0);
  } else if (input.startsWith('-')) {
    const token = input.slice(1).trim();
    const num = parseInt(token);
    if (!isNaN(num) && num >= 1 && num <= workingExisting.length) {
      const removed = workingExisting.splice(num - 1, 1)[0];
      console.log(`    ✕ Eliminado: "${removed}"`);
    } else if (token.length === 1 && token >= 'a' && token <= 'z') {
      const idx = token.charCodeAt(0) - 97;
      if (idx >= 0 && idx < workingNew.length) {
        const removed = workingNew.splice(idx, 1)[0];
        console.log(`    ✕ Eliminado nuevo: "${removed}"`);
      } else {
        console.log(`    ? Índice "${token}" fuera de rango`);
      }
    } else {
      const label = token.toLowerCase();
      let found = false;
      workingExisting = workingExisting.filter(c => {
        if (c.toLowerCase() === label) { found = true; return false; }
        return true;
      });
      if (!found) {
        workingNew = workingNew.filter(c => {
          if (c.toLowerCase() === label) { found = true; return false; }
          return true;
        });
      }
      if (found) console.log(`    ✕ Eliminado: "${label}"`);
      else console.log(`    ? No encontrado: "${label}"`);
    }
    showCurrentList();
  } else if (input.startsWith('+')) {
    const label = input.slice(1).trim().toLowerCase();
    if (label) {
      if (workingExisting.includes(label) || workingNew.includes(label)) {
        console.log(`    Ya existe: "${label}"`);
      } else if (existingConcepts.includes(label)) {
        workingExisting.push(label);
        console.log(`    ✓ Agregado (existente): "${label}"`);
      } else {
        workingNew.push(label);
        console.log(`    ✓ Agregado (nuevo): "${label}"`);
      }
      showCurrentList();
    }
  } else {
    console.log('    ? Comando no reconocido. Usa -N, -a, +palabra, ok, abort');
  }
}

rl.close();

const finalConcepts = [...workingExisting, ...workingNew];
if (finalConcepts.length === 0) {
  console.log('\nNo hay conceptos seleccionados. Cancelando.');
  process.exit(0);
}

console.log(`\n✅ ${finalConcepts.length} conceptos confirmados: ${finalConcepts.join(', ')}\n`);

// ══════════════════════════════════════════════════════════════════════
// STEP 2 — Generate excerpts using anchor-based referencing
// ══════════════════════════════════════════════════════════════════════

console.log('═══ PASO 2: Generación de excerpts ═══\n');
console.log('🤖 Enviando texto a Claude con conceptos curados...\n');

const step2Prompt = `Eres un asistente de análisis temático. Tu tarea es identificar pasajes (excerpts) en el texto y asignarles conceptos.

## MÉTODO DE MARCACIÓN — MUY IMPORTANTE

NO copies el texto del excerpt. En vez de eso, indica las FRONTERAS de cada excerpt usando:
- "start": las primeras 6-10 palabras exactas del excerpt (suficiente para localizarlo sin ambigüedad)
- "end": las últimas 6-10 palabras exactas del excerpt

El sistema buscará estas frases en el texto original y extraerá automáticamente todo lo que hay entre ellas. Esto garantiza que el texto extraído sea perfecto.

## Conceptos a usar (SOLO estos, no inventes nuevos)
${finalConcepts.map(c => `- ${c}`).join('\n')}

## Excerpts ya marcados (evitar solapamiento con estas zonas)
${existingExcerpts.length > 0
  ? existingExcerpts.map(e => `- [chars ${e.start}-${e.end}] "${e.text}..."`).join('\n')
  : '(ninguno)'}

## Texto a analizar (párrafos numerados)

${numberedText}

## Formato de respuesta

Devuelve SOLO un JSON:
\`\`\`json
{
  "excerpts": [
    {
      "start": "primeras 6-10 palabras exactas del pasaje",
      "end": "últimas 6-10 palabras exactas del pasaje",
      "concepts": ["concepto1", "concepto2"]
    }
  ]
}
\`\`\`

## REGLAS
1. Cada excerpt debe tener entre 1 y 3 conceptos de la lista.
2. Los excerpts deben cubrir al menos el 60-70% del texto significativo (excluye encabezados triviales).
3. Los excerpts NO deben solaparse entre sí.
4. Cada excerpt: mín ~20 palabras, máx ~150 palabras. Fragmentos coherentes con una idea completa.
5. Las anclas "start" y "end" deben ser EXACTAS — copia literal de las palabras del texto, respetando acentos y puntuación.
6. Si el excerpt es corto (una sola oración), "start" y "end" pueden ser la misma frase.
7. Busca cubrir el texto de forma continua — minimiza los huecos entre excerpts.
8. Responde SOLO con el JSON, sin texto adicional.`;

let step2Result;
try {
  const resp = callClaude(step2Prompt);
  step2Result = parseJsonResponse(resp);
} catch (e) {
  console.error('Error en paso 2:', e.message);
  process.exit(1);
}

if (!step2Result.excerpts || !Array.isArray(step2Result.excerpts)) {
  console.error('Respuesta inválida: falta array "excerpts"');
  process.exit(1);
}

console.log(`📝 Claude devolvió ${step2Result.excerpts.length} excerpts\n`);

// ── Process & validate ───────────────────────────────────────────────

let addedExcerpts = 0;
let addedConcepts = 0;
let skippedExcerpts = 0;
let failedAnchors = 0;

// concept label → id lookup
const conceptByLabel = {};
for (const c of Object.values(db.concepts)) {
  conceptByLabel[c.label.toLowerCase()] = c.id;
}

// Track all occupied ranges (existing + new)
const occupiedRanges = [...existingExcerpts];

for (let i = 0; i < step2Result.excerpts.length; i++) {
  const item = step2Result.excerpts[i];
  const startAnchor = item.start;
  const endAnchor = item.end;
  const concepts = item.concepts || [];

  if (!startAnchor || !endAnchor) {
    console.warn(`  ⚠️  #${i + 1}: anclas vacías, omitido`);
    failedAnchors++;
    continue;
  }

  // Resolve anchors to exact text positions
  const resolved = resolveAnchors(text, startAnchor, endAnchor);
  if (!resolved) {
    console.warn(`  ⚠️  #${i + 1}: no se encontraron las anclas`);
    console.warn(`       start: "${startAnchor}"`);
    console.warn(`       end:   "${endAnchor}"`);
    failedAnchors++;
    continue;
  }

  const { start, end, text: excerptText } = resolved;

  // Check minimum length (~20 words)
  if (excerptText.split(/\s+/).length < 5) {
    skippedExcerpts++;
    continue;
  }

  // Check overlap with occupied ranges
  const overlaps = occupiedRanges.some(r => start < r.end && end > r.start);
  if (overlaps) {
    skippedExcerpts++;
    continue;
  }

  // Resolve concept IDs
  const conceptIds = [];
  for (const label of concepts) {
    const key = label.toLowerCase().trim();
    if (conceptByLabel[key]) {
      conceptIds.push(conceptByLabel[key]);
    } else {
      const newId = makeId('con');
      if (!dryRun) {
        db.concepts[newId] = {
          id: newId,
          label: key,
          themeId: null,
          createdAt: now(),
        };
      }
      conceptByLabel[key] = newId;
      conceptIds.push(newId);
      addedConcepts++;
      console.log(`  🆕 Nuevo concepto: "${key}"`);
    }
  }

  // Create excerpt
  const excId = makeId('exc');
  if (!dryRun) {
    db.excerpts[excId] = {
      id: excId,
      sourceId: source.id,
      text: excerptText,
      start,
      end,
      conceptIds,
      createdAt: now(),
    };
  }
  addedExcerpts++;
  occupiedRanges.push({ start, end });

  const conceptLabels = concepts.join(', ');
  const preview = excerptText.replace(/\n/g, ' ').slice(0, 80);
  console.log(`  ✅ [${start}-${end}] (${excerptText.length} chars) ${conceptLabels}`);
  console.log(`     "${preview}..."`);
}

// ── Save ─────────────────────────────────────────────────────────────

if (!dryRun && addedExcerpts > 0) {
  const backupPath = DB_PATH.replace('.json', `.backup-${Date.now()}.json`);
  copyFileSync(DB_PATH, backupPath);
  console.log(`\n💾 Backup: ${backupPath}`);

  db.updatedAt = now();
  writeFileSync(DB_PATH, JSON.stringify(db, null, 2) + '\n', 'utf-8');
  console.log('💾 Base de datos actualizada.');
}

// ── Report ───────────────────────────────────────────────────────────

const totalExcerpts = (dryRun
  ? existingExcerpts.length + addedExcerpts
  : Object.values(db.excerpts).filter(e => e.sourceId === source.id).length);

const coveredChars = occupiedRanges.reduce((sum, r) => sum + (r.end - r.start), 0);
const coverage = ((coveredChars / text.length) * 100).toFixed(1);

console.log(`\n═══ Resultados ═══`);
console.log(`  Excerpts agregados:    ${addedExcerpts}`);
console.log(`  Conceptos creados:     ${addedConcepts}`);
console.log(`  Omitidos (overlap):    ${skippedExcerpts}`);
console.log(`  Fallidos (anclas):     ${failedAnchors}`);
console.log(`  Total excerpts:        ${totalExcerpts} (este documento)`);
console.log(`  Cobertura del texto:   ${coverage}%`);
console.log(`  Total conceptos DB:    ${Object.keys(db.concepts).length + (dryRun ? addedConcepts : 0)}`);
if (dryRun) console.log(`\n  ⚡ DRY RUN — sin cambios en disco`);
console.log('');
