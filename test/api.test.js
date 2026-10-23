// Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gymdesk-test-'));

// Stand-ins for Open Food Facts and USDA so tests run offline.
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  const u = String(url);
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (u.includes('/api/v2/product/9300000000001')) {
    return json({ status: 1, product: { code: '9300000000001', product_name: 'Greek Yoghurt Natural', brands: 'Chobani,Other', serving_size: '170 g', serving_quantity: 170,
      nutriments: { 'energy-kcal_100g': 58, proteins_100g: 10.1, carbohydrates_100g: 3.6, fat_100g: 0.2 } } });
  }
  if (u.includes('/api/v2/product/9300000000002')) {
    return json({ status: 1, product: { code: '9300000000002', product_name: 'Rolled Oats', nutriments: { energy_100g: 1590, proteins_100g: 12.1 } } });
  }
  if (u.includes('/api/v2/product/')) return json({ status: 0, status_verbose: 'product not found' }, 404);
  if (u.includes('/cgi/search.pl')) {
    return json({ products: [
      { code: '9300000000003', product_name: 'Chicken Breast Fillets', brands: 'Coles', nutriments: { 'energy-kcal_100g': 106, proteins_100g: 23.3, fat_100g: 1.6 } },
      { code: '9300000000004', product_name: 'No nutrition here', nutriments: {} },
    ] });
  }
  if (u.includes('api.nal.usda.gov')) {
    return json({ foods: [
      { fdcId: 171477, description: 'CHICKEN, BROILERS OR FRYERS, BREAST, MEAT ONLY, RAW', foodNutrients: [
        { nutrientId: 1008, value: 120 }, { nutrientId: 1003, value: 22.5 }, { nutrientId: 1004, value: 2.62 }, { nutrientId: 1005, value: 0 } ] },
      { fdcId: 2646170, description: 'Chicken, breast, boneless, skinless, raw', foodNutrients: [
        { nutrientId: 2047, value: 118 }, { nutrientId: 1003, value: 22.9 } ] },
    ] });
  }
  return realFetch(url, opts);
};

const app = require('../server/index.js');
let base, server;
test.before(() => new Promise((r) => { server = app.listen(0, () => { base = `http://127.0.0.1:${server.address().port}`; r(); }); }));
test.after(() => server.close());

async function api(method, p, body) {
  const res = await realFetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}

test('plan, sessions and settings round-trip', async () => {
  assert.equal((await api('PUT', '/api/plan/push', { name: 'Push', exercises: [{ id: 'a', name: 'Bench', sets: 3 }] })).status, 200);
  assert.equal((await api('PUT', '/api/plan/arms', { exercises: [] })).status, 400);
  await api('PUT', '/api/settings', { weeklyTarget: 3 });
  await api('PUT', '/api/sessions/s1', { id: 's1', day: 'push', date: '2026-10-22', status: 'active', startedAt: 1, updatedAt: 10, log: {} });
  const older = await api('PUT', '/api/sessions/s1', { id: 's1', day: 'push', status: 'active', startedAt: 1, updatedAt: 5 });
  assert.equal(older.body.applied, false, 'older copy must not overwrite a newer one');
  const st = await api('GET', '/api/state');
  assert.equal(st.body.plan.push.exercises[0].name, 'Bench');
  assert.equal(st.body.settings.weeklyTarget, 3);
  assert.equal(st.body.sessions[0].updatedAt, 10);
});

test('barcode lookup caches the product and handles kJ-only labels', async () => {
  const a = await api('GET', '/api/foods/barcode/9300000000001');
  assert.equal(a.status, 200);
  assert.equal(a.body.from, 'off');
  assert.equal(a.body.food.name, 'Greek Yoghurt Natural');
  assert.equal(a.body.food.brand, 'Chobani');
  assert.equal(a.body.food.kcal, 58);
  assert.equal(a.body.food.serving_g, 170);
  const again = await api('GET', '/api/foods/barcode/9300000000001');
  assert.equal(again.body.from, 'saved');
  const oats = await api('GET', '/api/foods/barcode/9300000000002');
  assert.equal(oats.body.food.kcal, 380); // 1590 kJ / 4.184
  const missing = await api('GET', '/api/foods/barcode/9399999999999');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.notFound, true);
});

test('search merges saved foods, Open Food Facts and USDA', async () => {
  const s = await api('GET', '/api/foods/search?q=chicken');
  assert.equal(s.body.off.length, 1, 'products with no nutrition are dropped');
  assert.equal(s.body.usda.length, 2);
  assert.equal(s.body.usda[0].name, 'Chicken, broilers or fryers, breast, meat only, raw');
  assert.equal(s.body.usda[1].kcal, 118);
});

test('logging food by grams, quick add, edit and day totals', async () => {
  const yog = (await api('GET', '/api/foods/barcode/9300000000001')).body.food;
  const e1 = await api('POST', '/api/food/log', { date: '2026-10-23', meal: 'breakfast', foodId: yog.id, grams: 170 });
  assert.equal(e1.status, 200);
  assert.equal(e1.body.entry.kcal, 98.6);
  assert.equal(e1.body.entry.protein, 17.2);
  // picking a search result saves it on the way in
  const usda = (await api('GET', '/api/foods/search?q=chicken')).body.usda[0];
  const e2 = await api('POST', '/api/food/log', { date: '2026-10-23', meal: 'dinner', food: usda, grams: 200 });
  assert.equal(e2.body.entry.protein, 45);
  assert.ok(e2.body.entry.food_id);
  const quick = await api('POST', '/api/food/log', { date: '2026-10-23', meal: 'snacks', name: 'Protein bar', kcal: 200, protein: 20 });
  assert.equal(quick.body.entry.kcal, 200);
  assert.equal((await api('POST', '/api/food/log', { date: '2026-10-23', meal: 'snacks', foodId: yog.id })).status, 400);
  const edited = await api('PATCH', '/api/food/log/' + e1.body.entry.id, { grams: 250 });
  assert.equal(edited.body.entry.kcal, 145);
  const replay = await api('POST', '/api/food/log', { id: e1.body.entry.id, date: '2026-10-23', meal: 'breakfast', foodId: yog.id, grams: 170 });
  assert.equal(replay.body.entry.grams, 250, 'replaying an offline write must not duplicate it');
  const day = await api('GET', '/api/food/day/2026-10-23');
  assert.equal(day.body.entries.length, 3);
  const tot = await api('GET', '/api/food/totals?from=2026-10-20&to=2026-10-26');
  assert.equal(tot.body.days[0].protein, 90.3);
  const recent = await api('GET', '/api/foods/recent');
  assert.ok(recent.body.foods.some((f) => f.id === yog.id && f.last_grams === 170));
});

test('custom foods, favourites and body entries', async () => {
  const c = await api('POST', '/api/foods', { name: 'Mum’s spag bol', kcal: 150, protein: 9, serving_g: 350 });
  assert.equal(c.body.food.source, 'custom');
  const fav = await api('PATCH', '/api/foods/' + c.body.food.id, { favourite: true });
  assert.equal(fav.body.food.favourite, true);
  assert.equal(fav.body.food.kcal, 150, 'patching one field keeps the rest');
  await api('PUT', '/api/body/2026-10-23', { weight: 74.6 });
  const b = await api('GET', '/api/body');
  assert.equal(b.body.entries[0].weight, 74.6);
});

test('export then import into a fresh database', async () => {
  const dump = (await api('GET', '/api/export')).body;
  assert.ok(dump.sessions.length && dump.foods.length && dump.foodLog.length);
  const imp = await api('POST', '/api/import', dump);
  assert.equal(imp.status, 200);
  assert.equal((await api('GET', '/api/food/day/2026-10-23')).body.entries.length, 3, 'import must not duplicate log entries');
});

test('saved meals round-trip and survive export/import', async () => {
  const items = [{ food_id: null, name: 'Oats', grams: 60, kcal100: 380, protein100: 12, kcal: 228, protein: 7.2 }];
  assert.equal((await api('PUT', '/api/meals/m1', { name: 'Usual breakfast', items })).status, 200);
  assert.equal((await api('PUT', '/api/meals/m2', { name: '', items })).status, 400);
  await api('POST', '/api/meals/m1/used');
  const list = (await api('GET', '/api/meals')).body.meals;
  assert.equal(list[0].name, 'Usual breakfast');
  assert.equal(list[0].use_count, 1);
  assert.equal(list[0].items[0].grams, 60);
  const dump = (await api('GET', '/api/export')).body;
  assert.equal(dump.meals.length, 1);
  assert.equal((await api('POST', '/api/import', dump)).body.counts.meals, 1);
});

test('recipes keep their ingredients and log by portion', async () => {
  const recipe = { items: [
    { name: 'Spaghetti, dry', grams: 500, kcal100: 350, protein100: 12, carbs100: 70, fat100: 1.5 },
    { name: 'Beef mince', grams: 500, kcal100: 170, protein100: 22, carbs100: 0, fat100: 9 },
    { name: 'Pasta sauce', grams: 500, kcal100: 50, protein100: 1.5, carbs100: 8, fat100: 1 },
  ], cooked_g: 2000, servings: 4 };
  // totals: 2850 kcal, 177.5 g protein over 2000 g cooked
  const saved = (await api('POST', '/api/foods', { source: 'recipe', name: 'Spag bol', kcal: 142.5, protein: 8.9, carbs: 19.5, fat: 5.8, serving_g: 500, serving_label: '1 of 4 serves', recipe })).body.food;
  assert.equal(saved.source, 'recipe');
  assert.equal(saved.recipe.items.length, 3);
  assert.equal(saved.recipe.cooked_g, 2000);
  const e = (await api('POST', '/api/food/log', { date: '2026-10-24', meal: 'dinner', foodId: saved.id, grams: 500 })).body.entry;
  assert.equal(e.kcal, 712.5);
  // editing the recipe keeps it a recipe; patching other fields keeps the ingredients
  const edited = (await api('PATCH', '/api/foods/' + saved.id, { recipe: { ...recipe, servings: 5 }, serving_g: 400 })).body.food;
  assert.equal(edited.recipe.servings, 5);
  const fav = (await api('PATCH', '/api/foods/' + saved.id, { favourite: true })).body.food;
  assert.equal(fav.recipe.items.length, 3, 'unrelated edits keep the ingredients');
  const again = (await api('POST', '/api/foods', { source: 'recipe', name: 'Spag bol', kcal: 140, recipe })).body.food;
  assert.notEqual(again.id, saved.id, 'a new recipe with the same name is its own food');
});
