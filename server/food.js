// Food lookups: Open Food Facts (barcodes, packaged food) and USDA FoodData Central (whole foods).
const UA = 'GymDesk/1.0 (self-hosted personal tracker)';
const OFF_BASE = process.env.OFF_BASE || 'https://world.openfoodfacts.org';
const OFF_COUNTRY = process.env.OFF_COUNTRY === undefined ? 'australia' : process.env.OFF_COUNTRY;
const USDA_KEY = process.env.USDA_API_KEY || 'DEMO_KEY';
const OFF_FIELDS = 'code,product_name,product_name_en,brands,nutriments,serving_size,serving_quantity,quantity';

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
function r1(n) { return n === null ? null : Math.round(n * 10) / 10; }
function clean(s) { return s ? String(s).replace(/\s+/g, ' ').trim() : ''; }

function offToFood(p, code) {
  if (!p) return null;
  const n = p.nutriments || {};
  let kcal = num(n['energy-kcal_100g']);
  if (kcal === null) {
    const kj = num(n['energy-kj_100g']) ?? num(n['energy_100g']);
    if (kj !== null) kcal = kj / 4.184;
  }
  const name = clean(p.product_name_en) || clean(p.product_name);
  const brand = clean(String(p.brands || '').split(',')[0]);
  const servingG = num(p.serving_quantity);
  return {
    source: 'off',
    source_id: String(p.code || code || ''),
    barcode: String(p.code || code || '') || null,
    name: name || (brand ? brand + ' product' : 'Unnamed product'),
    brand: brand || null,
    kcal: r1(kcal),
    protein: r1(num(n.proteins_100g)),
    carbs: r1(num(n.carbohydrates_100g)),
    fat: r1(num(n.fat_100g)),
    serving_g: servingG && servingG > 0 ? r1(servingG) : null,
    serving_label: clean(p.serving_size) || null,
  };
}

const USDA_IDS = { kcal: [1008, 2047, 2048], kj: [1062], protein: [1003], fat: [1004], carbs: [1005, 1050] };
function usdaNutrient(list, ids) {
  for (const id of ids) {
    const hit = list.find((x) => (x.nutrientId ?? (x.nutrient && x.nutrient.id)) === id);
    if (hit && num(hit.value ?? hit.amount) !== null) return num(hit.value ?? hit.amount);
  }
  return null;
}
function sentence(s) {
  s = clean(s);
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
}
function usdaToFood(f) {
  const list = f.foodNutrients || [];
  let kcal = usdaNutrient(list, USDA_IDS.kcal);
  if (kcal === null) {
    const kj = usdaNutrient(list, USDA_IDS.kj);
    if (kj !== null) kcal = kj / 4.184;
  }
  return {
    source: 'usda',
    source_id: String(f.fdcId),
    barcode: null,
    name: sentence(f.description) || 'Unnamed food',
    brand: null,
    kcal: r1(kcal),
    protein: r1(usdaNutrient(list, USDA_IDS.protein)),
    carbs: r1(usdaNutrient(list, USDA_IDS.carbs)),
    fat: r1(usdaNutrient(list, USDA_IDS.fat)),
    serving_g: null,
    serving_label: null,
  };
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
  if (res.status === 404) return { status: 404, body: null };
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return { status: res.status, body: await res.json() };
}

async function offBarcode(code) {
  const { status, body } = await getJson(`${OFF_BASE}/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`);
  if (status === 404 || !body || body.status === 0 || !body.product) return null;
  return offToFood(body.product, code);
}

async function offSearch(q, { worldwide = false } = {}) {
  const u = new URL(OFF_BASE + '/cgi/search.pl');
  u.searchParams.set('search_terms', q);
  u.searchParams.set('search_simple', '1');
  u.searchParams.set('action', 'process');
  u.searchParams.set('json', '1');
  u.searchParams.set('page_size', '20');
  u.searchParams.set('fields', OFF_FIELDS);
  if (OFF_COUNTRY && !worldwide) {
    u.searchParams.set('tagtype_0', 'countries');
    u.searchParams.set('tag_contains_0', 'contains');
    u.searchParams.set('tag_0', OFF_COUNTRY);
  }
  const { body } = await getJson(u.toString());
  return ((body && body.products) || []).map((p) => offToFood(p)).filter((f) => f && f.name && (f.kcal !== null || f.protein !== null));
}

async function usdaSearch(q) {
  const u = new URL('https://api.nal.usda.gov/fdc/v1/foods/search');
  u.searchParams.set('query', q);
  u.searchParams.set('dataType', 'Foundation,SR Legacy');
  u.searchParams.set('pageSize', '15');
  u.searchParams.set('api_key', USDA_KEY);
  const { body } = await getJson(u.toString());
  return ((body && body.foods) || []).map(usdaToFood).filter((f) => f.kcal !== null || f.protein !== null);
}

module.exports = { offBarcode, offSearch, usdaSearch, offToFood, usdaToFood, num };
