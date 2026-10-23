const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const { db, DATA_DIR } = require('./db');
const food = require('./food');
const afcd = require('./afcd');

const PORT = Number(process.env.PORT) || 8080;
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const USDA_MODE = (process.env.USDA || 'auto').toLowerCase();
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const VERSION = require('../package.json').version;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true); // behind cloudflared
app.use(express.json({ limit: '20mb' }));

/* ---------- helpers ---------- */
const now = () => Date.now();
const uid = () => crypto.randomUUID();
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const MEALS = ['breakfast', 'lunch', 'dinner', 'snacks'];
const DAYS = ['push', 'pull', 'legs'];
function n(v) { return food.num(v); }
function r1(x) { return x === null || x === undefined ? null : Math.round(x * 10) / 10; }
function bad(res, msg, code = 400) { return res.status(code).json({ error: msg }); }
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ---------- optional password ---------- */
function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const f = path.join(DATA_DIR, '.session-secret');
  try { return fs.readFileSync(f, 'utf8').trim(); } catch {}
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
}
const SECRET = APP_PASSWORD ? secret() : '';
const COOKIE = 'gd_session';
const COOKIE_DAYS = 180;
function sign(v) { return crypto.createHmac('sha256', SECRET).update(v).digest('base64url'); }
function readCookie(req) {
  const raw = req.headers.cookie || '';
  const m = raw.split(/;\s*/).find((c) => c.startsWith(COOKIE + '='));
  return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : '';
}
function authed(req) {
  if (!APP_PASSWORD) return true;
  const [exp, sig] = readCookie(req).split('.');
  if (!exp || !sig) return false;
  const expect = sign(exp);
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return false;
  return Number(exp) > now();
}
let failures = 0, lockUntil = 0;
app.post('/api/login', (req, res) => {
  if (!APP_PASSWORD) return res.json({ ok: true });
  if (now() < lockUntil) return bad(res, 'Too many attempts. Wait a minute and try again.', 429);
  const given = String((req.body && req.body.password) || '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(APP_PASSWORD).digest();
  if (!crypto.timingSafeEqual(a, b)) {
    failures++;
    if (failures >= 5) { lockUntil = now() + 60_000; failures = 0; }
    return bad(res, 'That password is wrong.', 401);
  }
  failures = 0;
  const exp = String(now() + COOKIE_DAYS * 86400_000);
  res.setHeader('Set-Cookie', `${COOKIE}=${exp}.${sign(exp)}; Path=/; Max-Age=${COOKIE_DAYS * 86400}; HttpOnly; SameSite=Lax${req.secure ? '; Secure' : ''}`);
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  res.json({ ok: true });
});
app.get('/healthz', (req, res) => res.json({ ok: true, version: VERSION }));
app.get('/api/me', (req, res) => res.json({ authed: authed(req), passwordRequired: !!APP_PASSWORD, version: VERSION }));
app.use('/api', (req, res, next) => (authed(req) ? next() : bad(res, 'Sign in first.', 401)));

/* ---------- training ---------- */
const q = {
  plans: db.prepare('SELECT day, data FROM plan'),
  putPlan: db.prepare('INSERT INTO plan(day, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(day) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'),
  sessions: db.prepare('SELECT id, data FROM sessions ORDER BY started_at DESC LIMIT ?'),
  getSession: db.prepare('SELECT data FROM sessions WHERE id = ?'),
  putSession: db.prepare(`INSERT INTO sessions(id, date, day, status, started_at, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET date = excluded.date, day = excluded.day, status = excluded.status, started_at = excluded.started_at, data = excluded.data, updated_at = excluded.updated_at`),
  delSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
  getSetting: db.prepare('SELECT data FROM settings WHERE key = ?'),
  putSetting: db.prepare('INSERT INTO settings(key, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'),
};

function savePlan(day, body) { q.putPlan.run(day, JSON.stringify(body), now()); }
function saveSession(id, body) {
  const cur = q.getSession.get(id);
  const old = cur && parse(cur.data);
  // Last write wins, except an older copy never overwrites a newer one (offline phone vs. PC).
  if (old && (old.updatedAt || 0) > (body.updatedAt || 0)) return false;
  body.id = id;
  q.putSession.run(id, body.date || null, body.day || null, body.status || null, Number(body.startedAt) || 0, JSON.stringify(body), now());
  return true;
}

app.get('/api/state', (req, res) => {
  const plan = {};
  for (const r of q.plans.all()) plan[r.day] = parse(r.data);
  const sessions = q.sessions.all(1000).map((r) => parse(r.data)).filter(Boolean);
  const s = q.getSetting.get('main');
  res.json({ plan, settings: s ? parse(s.data) : null, sessions, serverTime: now() });
});
app.put('/api/plan/:day', (req, res) => {
  const day = req.params.day;
  if (!DAYS.includes(day)) return bad(res, 'Unknown day.');
  if (!req.body || !Array.isArray(req.body.exercises)) return bad(res, 'A plan needs an exercises list.');
  savePlan(day, req.body);
  res.json({ ok: true });
});
app.put('/api/sessions/:id', (req, res) => {
  if (!req.body || typeof req.body !== 'object') return bad(res, 'Send the session as JSON.');
  const applied = saveSession(req.params.id, req.body);
  res.json({ ok: true, applied });
});
app.delete('/api/sessions/:id', (req, res) => { q.delSession.run(req.params.id); res.json({ ok: true }); });
app.put('/api/settings', (req, res) => {
  if (!req.body || typeof req.body !== 'object') return bad(res, 'Send settings as JSON.');
  q.putSetting.run('main', JSON.stringify(req.body), now());
  res.json({ ok: true });
});

/* ---------- foods ---------- */
const FOOD_COLS = 'id, barcode, source, source_id, name, brand, kcal, protein, carbs, fat, serving_g, serving_label, favourite, use_count, last_used, last_grams';
const fq = {
  byId: db.prepare(`SELECT ${FOOD_COLS} FROM foods WHERE id = ?`),
  byBarcode: db.prepare(`SELECT ${FOOD_COLS} FROM foods WHERE barcode = ?`),
  bySource: db.prepare(`SELECT ${FOOD_COLS} FROM foods WHERE source = ? AND source_id = ?`),
  recent: db.prepare(`SELECT ${FOOD_COLS} FROM foods WHERE favourite = 1 OR last_used IS NOT NULL ORDER BY favourite DESC, last_used DESC LIMIT 40`),
  search: db.prepare(`SELECT ${FOOD_COLS} FROM foods WHERE name LIKE ? OR brand LIKE ? OR barcode = ? ORDER BY favourite DESC, use_count DESC, name LIMIT 25`),
  insert: db.prepare(`INSERT INTO foods(id, barcode, source, source_id, name, brand, kcal, protein, carbs, fat, serving_g, serving_label, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  update: db.prepare(`UPDATE foods SET barcode = ?, name = ?, brand = ?, kcal = ?, protein = ?, carbs = ?, fat = ?, serving_g = ?, serving_label = ?, favourite = ?, updated_at = ? WHERE id = ?`),
  used: db.prepare('UPDATE foods SET use_count = use_count + 1, last_used = ?, last_grams = ? WHERE id = ?'),
  del: db.prepare('DELETE FROM foods WHERE id = ?'),
};
function foodOut(r) { return r ? { ...r, favourite: !!r.favourite } : null; }
function cleanFood(b, base = {}) {
  const t = (v, max) => (v === undefined ? undefined : v === null ? null : String(v).trim().slice(0, max) || null);
  const out = {
    barcode: t(b.barcode, 32), name: t(b.name, 140), brand: t(b.brand, 80),
    kcal: b.kcal === undefined ? undefined : r1(n(b.kcal)), protein: b.protein === undefined ? undefined : r1(n(b.protein)),
    carbs: b.carbs === undefined ? undefined : r1(n(b.carbs)), fat: b.fat === undefined ? undefined : r1(n(b.fat)),
    serving_g: b.serving_g === undefined ? undefined : r1(n(b.serving_g)), serving_label: t(b.serving_label, 60),
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) out[k] = base[k] === undefined ? null : base[k];
  if (out.barcode) out.barcode = out.barcode.replace(/\D/g, '') || null;
  return out;
}
// Save a food (custom, or picked from search) and return the stored row. Matches on barcode or source id.
function upsertFood(b) {
  const source = ['off', 'usda', 'afcd', 'custom'].includes(b.source) ? b.source : 'custom';
  const sourceId = b.source_id ? String(b.source_id) : null;
  let row = (b.id && fq.byId.get(b.id)) || (sourceId && source !== 'custom' && fq.bySource.get(source, sourceId)) || null;
  const c = cleanFood(b, row || {});
  if (!row && c.barcode) row = fq.byBarcode.get(c.barcode) || null;
  if (row) {
    const fav = b.favourite === undefined ? row.favourite : b.favourite ? 1 : 0;
    fq.update.run(c.barcode, c.name || row.name, c.brand, c.kcal, c.protein, c.carbs, c.fat, c.serving_g, c.serving_label, fav, now(), row.id);
    return foodOut(fq.byId.get(row.id));
  }
  if (!c.name) throw Object.assign(new Error('A food needs a name.'), { status: 400 });
  const id = uid();
  fq.insert.run(id, c.barcode, source, source === 'custom' ? null : sourceId, c.name, c.brand, c.kcal, c.protein, c.carbs, c.fat, c.serving_g, c.serving_label, now(), now());
  return foodOut(fq.byId.get(id));
}

app.get('/api/foods/recent', (req, res) => res.json({ foods: fq.recent.all().map(foodOut) }));
app.get('/api/foods/search', wrap(async (req, res) => {
  const term = String(req.query.q || '').trim().slice(0, 80);
  if (!term) return res.json({ local: [], afcd: [], off: [], usda: [], errors: {} });
  const like = '%' + term.replace(/[%_]/g, '') + '%';
  const local = fq.search.all(like, like, term.replace(/\D/g, '') || '-').map(foodOut);
  const have = new Set(local.map((f) => f.source + ':' + (f.source_id || f.id)));
  const fresh = (list) => list.filter((f) => !have.has(f.source + ':' + f.source_id));
  const au = fresh(afcd.search(term));
  const worldwide = req.query.worldwide === '1';
  // USDA is a fallback for whole foods the Australian database doesn't have (USDA=always to always include it).
  const wantUsda = USDA_MODE === 'always' || req.query.usda === '1' || (USDA_MODE !== 'off' && local.length + au.length < 4);
  const errors = {};
  const [off, usda] = await Promise.all([
    food.offSearch(term, { worldwide }).catch((e) => { errors.off = e.message; return []; }),
    wantUsda ? food.usdaSearch(term).catch((e) => { errors.usda = e.message; return []; }) : [],
  ]);
  res.json({ local, afcd: au, off: fresh(off), usda: fresh(usda), usdaSkipped: !wantUsda, errors });
}));
app.get('/api/foods/barcode/:code', wrap(async (req, res) => {
  const code = String(req.params.code).replace(/\D/g, '');
  if (code.length < 6) return bad(res, 'That doesn’t look like a barcode.');
  const local = fq.byBarcode.get(code);
  if (local) return res.json({ food: foodOut(local), from: 'saved' });
  let found;
  try { found = await food.offBarcode(code); } catch (e) { return bad(res, 'Open Food Facts didn’t answer. Try again, or add it yourself.', 502); }
  if (!found) return res.status(404).json({ notFound: true, barcode: code });
  res.json({ food: upsertFood(found), from: 'off' });
}));
app.post('/api/foods', wrap(async (req, res) => res.json({ food: upsertFood(req.body || {}) })));
app.patch('/api/foods/:id', wrap(async (req, res) => {
  const row = fq.byId.get(req.params.id);
  if (!row) return bad(res, 'That food no longer exists.', 404);
  res.json({ food: upsertFood({ ...req.body, id: row.id, source: row.source }) });
}));
app.delete('/api/foods/:id', (req, res) => { fq.del.run(req.params.id); res.json({ ok: true }); });

/* ---------- food log ---------- */
const lq = {
  day: db.prepare('SELECT * FROM food_log WHERE date = ? ORDER BY created_at'),
  byId: db.prepare('SELECT * FROM food_log WHERE id = ?'),
  insert: db.prepare(`INSERT INTO food_log(id, date, meal, food_id, name, brand, grams, kcal100, protein100, carbs100, fat100, kcal, protein, carbs, fat, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  update: db.prepare('UPDATE food_log SET date = ?, meal = ?, grams = ?, kcal = ?, protein = ?, carbs = ?, fat = ?, updated_at = ? WHERE id = ?'),
  del: db.prepare('DELETE FROM food_log WHERE id = ?'),
  totals: db.prepare(`SELECT date, ROUND(SUM(kcal)) kcal, ROUND(SUM(protein), 1) protein, ROUND(SUM(carbs), 1) carbs, ROUND(SUM(fat), 1) fat, COUNT(*) entries
    FROM food_log WHERE date BETWEEN ? AND ? GROUP BY date ORDER BY date`),
};
function amounts(per100, grams) {
  const f = (k) => (per100[k] === null || per100[k] === undefined || grams === null ? null : r1((per100[k] * grams) / 100));
  return { kcal: f('kcal'), protein: f('protein'), carbs: f('carbs'), fat: f('fat') };
}
app.get('/api/food/day/:date', (req, res) => {
  if (!isDate(req.params.date)) return bad(res, 'Use a YYYY-MM-DD date.');
  res.json({ entries: lq.day.all(req.params.date) });
});
app.get('/api/food/totals', (req, res) => {
  const { from, to } = req.query;
  if (!isDate(from) || !isDate(to)) return bad(res, 'Use YYYY-MM-DD dates.');
  res.json({ days: lq.totals.all(from, to) });
});
app.post('/api/food/log', wrap(async (req, res) => {
  const b = req.body || {};
  if (!isDate(b.date)) return bad(res, 'Use a YYYY-MM-DD date.');
  const meal = MEALS.includes(b.meal) ? b.meal : 'snacks';
  const id = b.id && typeof b.id === 'string' ? b.id.slice(0, 64) : uid();
  if (lq.byId.get(id)) return res.json({ entry: lq.byId.get(id) }); // replayed offline write
  let f = b.foodId ? fq.byId.get(b.foodId) : null;
  if (!f && b.food) f = upsertFood(b.food);
  const grams = r1(n(b.grams));
  let per100 = { kcal: null, protein: null, carbs: null, fat: null };
  let totals;
  if (f) {
    per100 = { kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat };
    if (grams === null || grams <= 0) return bad(res, 'Enter how many grams you had.');
    totals = amounts(per100, grams);
    fq.used.run(now(), grams, f.id);
  } else {
    // Quick add: no food, just the numbers.
    totals = { kcal: r1(n(b.kcal)), protein: r1(n(b.protein)), carbs: r1(n(b.carbs)), fat: r1(n(b.fat)) };
    if (totals.kcal === null && totals.protein === null) return bad(res, 'Enter calories or protein.');
  }
  const name = (f && f.name) || String(b.name || 'Quick add').slice(0, 140);
  const t = Number(b.createdAt) || now();
  lq.insert.run(id, b.date, meal, f ? f.id : null, name, f ? f.brand : null, grams, per100.kcal, per100.protein, per100.carbs, per100.fat,
    totals.kcal, totals.protein, totals.carbs, totals.fat, t, now());
  res.json({ entry: lq.byId.get(id) });
}));
app.patch('/api/food/log/:id', (req, res) => {
  const e = lq.byId.get(req.params.id);
  if (!e) return bad(res, 'That entry no longer exists.', 404);
  const b = req.body || {};
  const date = isDate(b.date) ? b.date : e.date;
  const meal = MEALS.includes(b.meal) ? b.meal : e.meal;
  let grams = e.grams, t = { kcal: e.kcal, protein: e.protein, carbs: e.carbs, fat: e.fat };
  const hasPer100 = e.kcal100 !== null || e.protein100 !== null;
  if (b.grams !== undefined && hasPer100) {
    grams = r1(n(b.grams));
    if (grams === null || grams <= 0) return bad(res, 'Enter how many grams you had.');
    t = amounts({ kcal: e.kcal100, protein: e.protein100, carbs: e.carbs100, fat: e.fat100 }, grams);
  } else if (!hasPer100) {
    for (const k of ['kcal', 'protein', 'carbs', 'fat']) if (b[k] !== undefined) t[k] = r1(n(b[k]));
  }
  lq.update.run(date, meal, grams, t.kcal, t.protein, t.carbs, t.fat, now(), e.id);
  res.json({ entry: lq.byId.get(e.id) });
});
app.delete('/api/food/log/:id', (req, res) => { lq.del.run(req.params.id); res.json({ ok: true }); });

/* ---------- body ---------- */
const bq = {
  all: db.prepare('SELECT date, weight, waist, arm, note FROM body ORDER BY date DESC LIMIT 730'),
  put: db.prepare(`INSERT INTO body(date, weight, waist, arm, note, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET weight = excluded.weight, waist = excluded.waist, arm = excluded.arm, note = excluded.note, updated_at = excluded.updated_at`),
  del: db.prepare('DELETE FROM body WHERE date = ?'),
};
app.get('/api/body', (req, res) => res.json({ entries: bq.all.all() }));
app.put('/api/body/:date', (req, res) => {
  if (!isDate(req.params.date)) return bad(res, 'Use a YYYY-MM-DD date.');
  const b = req.body || {};
  const v = { weight: r1(n(b.weight)), waist: r1(n(b.waist)), arm: r1(n(b.arm)), note: b.note ? String(b.note).slice(0, 300) : null };
  if (v.weight === null && v.waist === null && v.arm === null) { bq.del.run(req.params.date); return res.json({ ok: true, deleted: true }); }
  bq.put.run(req.params.date, v.weight, v.waist, v.arm, v.note, now());
  res.json({ ok: true });
});
app.delete('/api/body/:date', (req, res) => { bq.del.run(req.params.date); res.json({ ok: true }); });

/* ---------- Australian food database ---------- */
app.get('/api/afcd', (req, res) => res.json(afcd.status()));
app.post('/api/afcd/refresh', wrap(async (req, res) => res.json(await afcd.refresh())));
app.post('/api/afcd/upload', express.raw({ type: () => true, limit: '30mb' }), (req, res) => {
  if (!req.body || !req.body.length) return bad(res, 'Choose the FSANZ “Nutrient profiles” .xlsx file.');
  try { res.json(afcd.importFile(req.body)); } catch (e) { bad(res, e.message); }
});

/* ---------- saved meals ---------- */
const mq = {
  all: db.prepare('SELECT id, name, items, use_count, last_used FROM saved_meals ORDER BY use_count DESC, name'),
  put: db.prepare(`INSERT INTO saved_meals(id, name, items, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, items = excluded.items, updated_at = excluded.updated_at`),
  used: db.prepare('UPDATE saved_meals SET use_count = use_count + 1, last_used = ? WHERE id = ?'),
  del: db.prepare('DELETE FROM saved_meals WHERE id = ?'),
};
const mealOut = (r) => ({ id: r.id, name: r.name, items: parse(r.items) || [], use_count: r.use_count, last_used: r.last_used });
function cleanItems(items) {
  return (Array.isArray(items) ? items : []).slice(0, 40).map((e) => ({
    food_id: e.food_id || null, name: String(e.name || 'Food').slice(0, 140), brand: e.brand || null, grams: r1(n(e.grams)),
    kcal100: r1(n(e.kcal100)), protein100: r1(n(e.protein100)), carbs100: r1(n(e.carbs100)), fat100: r1(n(e.fat100)),
    kcal: r1(n(e.kcal)), protein: r1(n(e.protein)), carbs: r1(n(e.carbs)), fat: r1(n(e.fat)),
  }));
}
app.get('/api/meals', (req, res) => res.json({ meals: mq.all.all().map(mealOut) }));
app.put('/api/meals/:id', (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 80);
  const items = cleanItems(b.items);
  if (!name) return bad(res, 'Give the meal a name.');
  if (!items.length) return bad(res, 'A meal needs at least one food.');
  mq.put.run(req.params.id.slice(0, 64), name, JSON.stringify(items), now(), now());
  res.json({ ok: true });
});
app.post('/api/meals/:id/used', (req, res) => { mq.used.run(now(), req.params.id); res.json({ ok: true }); });
app.delete('/api/meals/:id', (req, res) => { mq.del.run(req.params.id); res.json({ ok: true }); });

/* ---------- backup ---------- */
app.get('/api/export', (req, res) => {
  const plan = {};
  for (const r of q.plans.all()) plan[r.day] = parse(r.data);
  const s = q.getSetting.get('main');
  const out = {
    app: 'gym-desk', version: VERSION, exportedAt: new Date().toISOString(),
    plan, settings: s ? parse(s.data) : null,
    sessions: db.prepare('SELECT data FROM sessions ORDER BY started_at').all().map((r) => parse(r.data)),
    foods: db.prepare(`SELECT ${FOOD_COLS} FROM foods`).all().map(foodOut),
    foodLog: db.prepare('SELECT * FROM food_log ORDER BY date, created_at').all(),
    body: db.prepare('SELECT date, weight, waist, arm, note FROM body ORDER BY date').all(),
    meals: mq.all.all().map(mealOut),
  };
  res.setHeader('Content-Disposition', `attachment; filename="gym-desk-backup-${out.exportedAt.slice(0, 10)}.json"`);
  res.json(out);
});
app.post('/api/import', (req, res) => {
  const b = req.body || {};
  const counts = { plan: 0, sessions: 0, settings: 0, foods: 0, foodLog: 0, body: 0, meals: 0 };
  db.exec('BEGIN');
  try {
    for (const day of DAYS) if (b.plan && b.plan[day] && Array.isArray(b.plan[day].exercises)) { savePlan(day, b.plan[day]); counts.plan++; }
    if (b.settings && typeof b.settings === 'object') { q.putSetting.run('main', JSON.stringify(b.settings), now()); counts.settings++; }
    for (const s of b.sessions || []) if (s && s.id && saveSession(s.id, s)) counts.sessions++;
    const idMap = {};
    for (const f of b.foods || []) {
      if (!f || !f.name) continue;
      const exists = f.id && fq.byId.get(f.id);
      const saved = exists ? upsertFood(f) : upsertFood({ ...f, id: undefined });
      idMap[f.id] = saved.id; counts.foods++;
    }
    for (const e of b.foodLog || []) {
      if (!e || !e.id || !isDate(e.date) || lq.byId.get(e.id)) continue;
      lq.insert.run(e.id, e.date, MEALS.includes(e.meal) ? e.meal : 'snacks', idMap[e.food_id] || e.food_id || null, String(e.name || 'Food'), e.brand || null,
        n(e.grams), n(e.kcal100), n(e.protein100), n(e.carbs100), n(e.fat100), n(e.kcal), n(e.protein), n(e.carbs), n(e.fat), Number(e.created_at) || now(), now());
      counts.foodLog++;
    }
    for (const x of b.body || []) if (x && isDate(x.date)) { bq.put.run(x.date, n(x.weight), n(x.waist), n(x.arm), x.note || null, now()); counts.body++; }
    for (const m of b.meals || []) {
      const items = cleanItems(m && m.items).map((e) => ({ ...e, food_id: idMap[e.food_id] || e.food_id }));
      if (m && m.id && m.name && items.length) { mq.put.run(String(m.id).slice(0, 64), String(m.name).slice(0, 80), JSON.stringify(items), now(), now()); counts.meals++; }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return bad(res, 'Import failed: ' + e.message);
  }
  res.json({ ok: true, counts });
});

/* ---------- app shell ---------- */
app.use(express.static(PUBLIC_DIR, {
  setHeaders(res, file) {
    if (/\.(woff2|png|svg)$/.test(file)) res.setHeader('Cache-Control', 'public, max-age=2592000');
    else res.setHeader('Cache-Control', 'no-cache');
  },
}));
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});
app.use('/api', (req, res) => bad(res, 'Not found.', 404));
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return bad(res, 'That wasn’t valid JSON.');
  if (err.status && err.status < 500) return bad(res, err.message, err.status);
  console.error(err);
  bad(res, 'Something went wrong on the server.', 500);
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Gym Desk ${VERSION} on :${PORT}${APP_PASSWORD ? ' (password on)' : ''} · data in ${DATA_DIR}`);
    afcd.ensure();
  });
}
module.exports = app;
