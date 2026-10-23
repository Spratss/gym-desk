const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.DATA_DIR = process.env.DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'gymdesk-afcd-'));
const afcd = require('../server/afcd');
const sample = fs.readFileSync(path.join(__dirname, 'fixtures', 'afcd-sample.xlsx'));

test('parses the per-100 g sheet by column names', () => {
  const { foods, sheet } = afcd.parseAfcd(sample);
  assert.equal(sheet, 'All solids & liquids per 100g');
  assert.equal(foods.length, 6);
  const chicken = foods[0];
  assert.equal(chicken.name, 'Chicken, breast, lean flesh, raw');
  assert.equal(chicken.kcal, 109.9); // 460 kJ / 4.184
  assert.equal(chicken.protein, 23);
  const yog = foods.find((f) => f.key === 'T000004');
  assert.equal(yog.protein, 9, 'numbers stored as text still parse');
  assert.equal(foods.find((f) => f.key === 'T000005').carbs, 0, '"tr" (trace) counts as 0');
});

test('imports and searches with every word matching, best match first', () => {
  const st = afcd.importFile(sample);
  assert.equal(st.count, 6);
  const r = afcd.search('chicken breast');
  assert.deepEqual(r.map((f) => f.source_id), ['T000001', 'T000002']);
  assert.equal(r[0].source, 'afcd');
  assert.equal(afcd.search('chick')[0].name.startsWith('Chick'), true);
  assert.equal(afcd.search('greek yoghurt').length, 1);
  assert.equal(afcd.status().count, 6);
});

test('refresh downloads from FSANZ and reports failures', async () => {
  const ok = await afcd.refresh(async () => new Response(sample));
  assert.equal(ok.ok, true);
  const fail = await afcd.refresh(async () => new Response('nope', { status: 404 }));
  assert.equal(fail.ok, false);
  assert.match(fail.error, /404/);
  assert.equal(fail.count, 6, 'a failed refresh keeps the foods already loaded');
});

test('rejects a spreadsheet without the right columns', () => {
  assert.throws(() => afcd.parseAfcd(fs.readFileSync(path.join(__dirname, 'fixtures', 'afcd-sample.xlsx')).subarray(0, 50)));
});
