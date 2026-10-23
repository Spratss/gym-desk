// Australian Food Composition Database (Food Standards Australia New Zealand), CC BY 4.0.
// Downloaded by the server on first start and kept in the local database.
const fs = require('node:fs');
const path = require('node:path');
const { db } = require('./db');
const { readWorkbook } = require('./xlsx');
const BUNDLED = path.join(__dirname, 'data', 'afcd.json');

const AFCD_URL = process.env.AFCD_URL || 'https://www.foodstandards.gov.au/sites/default/files/2025-12/AFCD%20Release%203%20-%20Nutrient%20profiles.xlsx';
const DISABLED = process.env.AFCD === 'off';

db.exec(`
CREATE TABLE IF NOT EXISTS ref_foods (
  source TEXT NOT NULL,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  kcal REAL, protein REAL, carbs REAL, fat REAL, fibre REAL,
  ord INTEGER,
  PRIMARY KEY (source, key)
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);
try { db.exec('ALTER TABLE ref_foods ADD COLUMN ord INTEGER'); } catch {} // older databases

const getMeta = db.prepare('SELECT value FROM meta WHERE key = ?');
const putMeta = db.prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
const count = db.prepare("SELECT COUNT(*) n FROM ref_foods WHERE source = 'afcd'");

function norm(h) { return String(h || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
function num(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || /^(n\/?a|-|—|tr)$/i.test(s)) return /^tr$/i.test(s) ? 0 : null;
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
const r1 = (n) => (n === null ? null : Math.round(n * 10) / 10);

// Find the per-100 g sheet and its header row by looking for the column names, not fixed positions,
// so a new release with a moved header still loads.
function parseAfcd(buf) {
  const { sheets } = readWorkbook(buf);
  if (!sheets.length) throw new Error('The spreadsheet has no sheets.');
  const ranked = sheets.slice().sort((a, b) => score(b.name) - score(a.name));
  for (const sh of ranked) {
    const hi = sh.rows.findIndex((r, i) => i < 30 && r.some((c) => norm(c) === 'food name') && r.some((c) => /food key|food id/.test(norm(c))));
    if (hi < 0) continue;
    const head = sh.rows[hi].map(norm);
    const col = (...tests) => { for (const t of tests) { const i = head.findIndex((h) => t.test(h)); if (i >= 0) return i; } return -1; };
    const c = {
      key: col(/^public food key/, /food key/, /food id/),
      name: col(/^food name$/),
      kj: col(/^energy with dietary fibre, equated/, /^energy with dietary fibre/, /^energy, with dietary fibre/, /^energy.*\(kj\)/),
      kcal: col(/^energy.*\(kcal\)/),
      protein: col(/^protein/),
      fat: col(/^fat,? total/, /^total fat/),
      carbs: col(/^available carbohydrate, with sugar alcohols/, /^available carbohydrate/, /^carbohydrate/),
      fibre: col(/^total dietary fibre/, /^dietary fibre/),
    };
    if (c.key < 0 || c.name < 0 || (c.kj < 0 && c.kcal < 0) || c.protein < 0) continue;
    const foods = [];
    for (const r of sh.rows.slice(hi + 1)) {
      const key = String(r[c.key] || '').trim(), name = String(r[c.name] || '').replace(/\s+/g, ' ').trim();
      if (!key || !name) continue;
      let kcal = c.kcal >= 0 ? num(r[c.kcal]) : null;
      if (kcal === null && c.kj >= 0) { const kj = num(r[c.kj]); if (kj !== null) kcal = kj / 4.184; }
      foods.push({ key, name, kcal: r1(kcal), protein: r1(num(r[c.protein])), carbs: c.carbs >= 0 ? r1(num(r[c.carbs])) : null,
        fat: c.fat >= 0 ? r1(num(r[c.fat])) : null, fibre: c.fibre >= 0 ? r1(num(r[c.fibre])) : null });
    }
    if (foods.length) return { foods, sheet: sh.name };
  }
  throw new Error('Couldn’t find the food name, energy and protein columns in that spreadsheet.');
  function score(n) { n = norm(n); return (/100 ?g/.test(n) ? 4 : 0) + (/solid/.test(n) ? 2 : 0) - (/ml\b|liquid/.test(n) && !/solid/.test(n) ? 3 : 0) - (/note|read ?me|about|key|info/.test(n) ? 5 : 0); }
}

function store(parsed, from) {
  const ins = db.prepare('INSERT INTO ref_foods(source, key, name, kcal, protein, carbs, fat, fibre, ord) VALUES (\'afcd\', ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(source, key) DO UPDATE SET name = excluded.name, kcal = excluded.kcal, protein = excluded.protein, carbs = excluded.carbs, fat = excluded.fat, fibre = excluded.fibre, ord = excluded.ord');
  db.exec('BEGIN');
  try {
    db.exec("DELETE FROM ref_foods WHERE source = 'afcd'");
    parsed.foods.forEach((f, i) => ins.run(f.key, f.name, f.kcal, f.protein, f.carbs, f.fat, f.fibre, i));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  const st = { ok: true, count: parsed.foods.length, sheet: parsed.sheet, release: parsed.release || null, from, at: new Date().toISOString() };
  putMeta.run('afcd', JSON.stringify(st));
  return st;
}

let running = null;
async function refresh(fetchImpl = fetch) {
  if (running) return running;
  running = (async () => {
    try {
      const res = await fetchImpl(AFCD_URL, { headers: { 'User-Agent': 'GymDesk/1.0' }, signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error('FSANZ download failed (HTTP ' + res.status + ')');
      const buf = new Uint8Array(await res.arrayBuffer());
      const st = store(parseAfcd(buf), AFCD_URL);
      console.log(`Australian foods: loaded ${st.count} from FSANZ`);
      return st;
    } catch (e) {
      const why = e.cause && (e.cause.code || e.cause.message);
      const st = { ok: false, count: count.get().n, error: e.message + (why ? ' (' + why + ')' : ''), at: new Date().toISOString() };
      putMeta.run('afcd', JSON.stringify(st));
      console.warn('Australian foods: ' + e.message);
      return st;
    } finally { running = null; }
  })();
  return running;
}
function importFile(buf) { return store(parseAfcd(buf), 'upload'); }
function status() {
  const m = getMeta.get('afcd');
  const st = m ? JSON.parse(m.value) : { ok: false, count: 0 };
  st.count = count.get().n;
  st.disabled = DISABLED;
  st.loading = !!running;
  return st;
}
// The app ships with a parsed copy of the current release, so it works on first start with no download.
function loadBundled() {
  const b = JSON.parse(fs.readFileSync(BUNDLED, 'utf8'));
  const foods = b.foods.map(([key, name, kcal, protein, carbs, fat, fibre]) => ({ key, name, kcal, protein, carbs, fat, fibre }));
  return store({ foods, sheet: b.sheet, release: b.release }, 'bundled');
}
function ensure() {
  if (DISABLED || count.get().n > 0) return;
  try { const st = loadBundled(); console.log(`Australian foods: loaded ${st.count} (${st.release}, bundled)`); }
  catch (e) { console.warn('Australian foods: bundled copy unreadable (' + e.message + '), downloading'); refresh(); }
}

const searchStmt = db.prepare("SELECT key, name, kcal, protein, carbs, fat, ord FROM ref_foods WHERE source = 'afcd' AND name LIKE ? ORDER BY ord LIMIT 600");
const SYNONYMS = { yogurt: 'yoghurt', yoghurts: 'yoghurt', mincemeat: 'mince', minced: 'mince', bell: 'capsicum', zucchini: 'zucchini', courgette: 'zucchini', prawns: 'prawn', shrimp: 'prawn' };
function variants(w) {
  w = SYNONYMS[w] || w;
  const out = [w];
  if (w.length > 3 && w.endsWith('es')) out.push(w.slice(0, -2));
  if (w.length > 3 && w.endsWith('s')) out.push(w.slice(0, -1));
  return out;
}
const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Every word must match (plural or synonym is fine). Names whose first part is the first word rank highest
// ("Milk, cow" before "Milkfish"), then whole-word matches; FSANZ's own order breaks ties.
function search(term) {
  const words = String(term).toLowerCase().split(/[\s,]+/).filter((w) => w.length > 1).slice(0, 6).map(variants);
  if (!words.length) return [];
  const rows = searchStmt.all('%' + words[0][words[0].length - 1].replace(/[%_]/g, '') + '%')
    .filter((r) => { const n = r.name.toLowerCase(); return words.every((vs) => vs.some((w) => n.includes(w))); });
  const rank = (r) => {
    const n = r.name.toLowerCase(), first = n.split(',')[0].trim();
    let s = 0;
    if (words[0].some((w) => first === w || first === w + 's')) s -= 20;
    else if (words[0].some((w) => new RegExp('^' + esc(w) + '\\b').test(n))) s -= 10;
    const lead = n.split(',').slice(0, 2).join(',');
    for (const vs of words) {
      if (vs.some((w) => new RegExp('\\b' + esc(w) + '\\b').test(lead))) s -= 5;
      else if (vs.some((w) => new RegExp('\\b' + esc(w) + '\\b').test(n))) s -= 3;
    }
    return s + r.ord / 10000;
  };
  return rows.sort((a, b) => rank(a) - rank(b)).slice(0, 20).map((r) => ({
    source: 'afcd', source_id: r.key, barcode: null, name: r.name, brand: null,
    kcal: r.kcal, protein: r.protein, carbs: r.carbs, fat: r.fat, serving_g: null, serving_label: null,
  }));
}

module.exports = { parseAfcd, refresh, importFile, loadBundled, status, ensure, search, AFCD_URL };
