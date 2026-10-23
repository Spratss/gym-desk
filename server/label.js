// Read a nutrition information panel from a photo.
// With ANTHROPIC_API_KEY set, Claude reads it (most accurate). Otherwise Tesseract OCR runs on this server.
const path = require('node:path');

const KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';
const r1 = (n) => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);
const num = (s) => { if (s === null || s === undefined) return null; const n = parseFloat(String(s).replace(',', '.')); return Number.isFinite(n) ? n : null; };

/* ---------- Claude ---------- */
const PROMPT = `This is a photo of a food product's nutrition information panel (often Australian, with energy in kJ).
Reply with only a JSON object and nothing else:
{"readable": true, "name": null, "brand": null, "serving_g": null, "per100": {"kj": null, "kcal": null, "protein": null, "carbs": null, "fat": null}}
- Use the per 100 g (or per 100 mL) column.
- If the panel only shows per serving, convert to per 100 g using the serving size.
- carbs is total carbohydrate (not sugars); fat is total fat (not saturated).
- name and brand only if they are visible in the photo.
- If this isn't a nutrition panel or you can't read it, set "readable" to false.`;

async function readWithClaude(buf, mediaType, fetchImpl = fetch) {
  const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 400,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: Buffer.from(buf).toString('base64') } },
        { type: 'text', text: PROMPT },
      ] }],
    }),
    signal: AbortSignal.timeout(45000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body.error && body.error.message) || 'Claude API returned HTTP ' + res.status);
  const text = (body.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Claude didn’t return the label values.');
  const j = JSON.parse(m[0]);
  if (j.readable === false) return { readable: false };
  const p = j.per100 || {};
  let kcal = num(p.kcal);
  if (kcal === null && num(p.kj) !== null) kcal = num(p.kj) / 4.184;
  return {
    readable: true, name: j.name || null, brand: j.brand || null, serving_g: r1(num(j.serving_g)),
    kcal: r1(kcal), protein: r1(num(p.protein)), carbs: r1(num(p.carbs)), fat: r1(num(p.fat)),
  };
}

/* ---------- Tesseract ---------- */
let worker = null, starting = null, idle = null;
async function getWorker() {
  if (!worker) {
    if (!starting) {
      const { createWorker } = require('tesseract.js');
      const langPath = path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');
      starting = createWorker('eng', 1, { langPath, cacheMethod: 'none', gzip: true })
        .then(async (w) => { await w.setParameters({ preserve_interword_spaces: '1' }); worker = w; return w; })
        .finally(() => { starting = null; });
    }
    await starting;
  }
  clearTimeout(idle);
  idle = setTimeout(() => { if (worker) { worker.terminate(); worker = null; } }, 5 * 60 * 1000); // free memory when idle
  idle.unref();
  return worker;
}
async function readWithOcr(buf) {
  const w = await getWorker();
  const { data } = await w.recognize(Buffer.from(buf));
  return parseLabelText(data.text || '');
}

// Turn OCR text of an Australian-style panel into per-100 g numbers.
// Panels list "per serving" then "per 100 g", so the last value on a row is usually per 100 g.
function parseLabelText(text) {
  const fix = (s) => s
    .replace(/(\d)[oO](?=\d|\s*[gk%m])/g, '$10').replace(/[oO](?=\d)/g, '0')     // O read as 0
    .replace(/(\d)\s*[,](\d)/g, '$1.$2')                                          // 1,5 → 1.5
    .replace(/(\d)\s*k[jJ)\]l1|]/g, '$1kJ');                                      // 1590k) → 1590kJ
  const lines = text.split(/\r?\n/).map((l) => fix(l.replace(/\s+/g, ' ').trim())).filter(Boolean);
  const low = lines.map((l) => l.toLowerCase());
  const all = low.join('\n');

  const serveM = all.match(/serv(?:ing|e)\s*size[^0-9]{0,12}([\d.]+)\s*(g|ml|m1)\b/);
  const serving = serveM ? num(serveM[1]) : null;
  const head = low.find((l) => /100\s*(g|ml|m1)/.test(l) && /serv/.test(l));
  const per100Last = head ? head.search(/serv/) < head.search(/100\s*(g|ml|m1)/) : true;
  const onlyPer100 = !head && low.some((l) => /per\s*100\s*(g|ml)/.test(l)) && !low.some((l) => /per\s*serv/.test(l));

  const values = (l, unit) => {
    const out = [];
    const re = unit === 'kj' ? /(\d+(?:\.\d+)?)\s*kj/g : unit === 'kcal' ? /(\d+(?:\.\d+)?)\s*(?:kcal|cal)\b/g : /(\d+(?:\.\d+)?)\s*(g|mg)?\b(?!\s*%)/g;
    let m;
    while ((m = re.exec(l))) { if (unit === 'g' && m[2] === 'mg') continue; out.push(num(m[1])); }
    return out;
  };
  const pick = (arr) => {
    if (!arr.length) return { v: null, per: null };
    if (arr.length === 1) return { v: arr[0], per: onlyPer100 ? '100' : 'serve' };
    return { v: per100Last ? arr[arr.length - 1] : arr[0], per: '100' };
  };
  const rowFor = (test) => { const i = low.findIndex(test); return i < 0 ? null : low[i].replace(/^[^a-z]*/, ''); };
  const toPer100 = (r) => (r.v === null ? null : r.per === 'serve' ? (serving ? r.v * 100 / serving : null) : r.v);

  const energyRow = rowFor((l) => /energy/.test(l));
  let kcal = null;
  if (energyRow) {
    const kc = pick(values(energyRow, 'kcal')), kj = pick(values(energyRow, 'kj'));
    kcal = kc.v !== null ? toPer100(kc) : kj.v !== null ? (toPer100(kj) === null ? null : toPer100(kj) / 4.184) : null;
    if (kcal === null) { const plain = pick(values(energyRow.replace(/energy/, ''), 'g').filter((x) => x > 30)); kcal = toPer100(plain); if (kcal !== null && kcal > 900) kcal /= 4.184; }
  }
  // OCR often reads the "g" unit as 9 or q: "11.79" is 11.7g (panels give grams to one decimal), and a whole number
  // over 100 ending in 9 ("129") is 12g, since no macro can exceed 100 g per 100 g.
  const gramFix = (row) => row.replace(/(\d+\.\d)9\b/g, '$1g').replace(/(\d)q\b/g, '$1g').replace(/\b(\d{2,3})9\b/g, (m, a) => (Number(m) > 100 ? a + 'g' : m));
  const grams = (row) => (row ? toPer100(pick(values(gramFix(row.replace(/^[a-z ,\-–.()]+/, '')), 'g'))) : null); // drop the row label, keep the numbers
  const protein = grams(rowFor((l) => /prote/.test(l)));
  const fat = grams(rowFor((l) => /\bfat\b|fat,|total fat/.test(l) && !/satur|trans|poly|mono/.test(l)));
  const carbs = grams(rowFor((l) => /carbo/.test(l) && !/sugar/.test(l)));
  const found = [kcal, protein, carbs, fat].filter((x) => x !== null).length;
  return { readable: found >= 2, serving_g: r1(serving), kcal: r1(kcal), protein: r1(protein), carbs: r1(carbs), fat: r1(fat), found };
}

async function read(buf, mediaType) {
  if (KEY) {
    try { return { engine: 'claude', ...(await readWithClaude(buf, mediaType)) }; }
    catch (e) { const r = await readWithOcr(buf); return { engine: 'ocr', note: 'Claude couldn’t read it (' + e.message + '), so it was read on the server instead.', ...r }; }
  }
  return { engine: 'ocr', ...(await readWithOcr(buf)) };
}
const engine = () => (KEY ? 'claude' : 'ocr');
async function close() { clearTimeout(idle); if (starting) await starting.catch(() => {}); if (worker) { const w = worker; worker = null; await w.terminate(); } }

module.exports = { read, readWithClaude, parseLabelText, engine, close };
