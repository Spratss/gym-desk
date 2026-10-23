const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const label = require('../server/label');
test.after(() => label.close());

test('reads an Australian nutrition panel photo on the server (OCR)', { timeout: 120000 }, async () => {
  const r = await label.read(fs.readFileSync(path.join(__dirname, 'fixtures', 'label-oats.jpg')), 'image/jpeg');
  assert.equal(r.engine, 'ocr');
  assert.equal(r.readable, true);
  assert.deepEqual({ serving_g: r.serving_g, kcal: r.kcal, protein: r.protein, carbs: r.carbs, fat: r.fat },
    { serving_g: 30, kcal: 382.4, protein: 11.7, carbs: 60, fat: 7 });
});

test('label text parsing handles common OCR misreads and per-serving-only panels', () => {
  const r = label.parseLabelText('Serving size: 50g\nQuantity per serving\nEnergy 800k)\nProtein 10.0q\nFat, total 5.09\n- saturated 1.09\nCarbohydrate 129\n- sugars 2.09');
  assert.deepEqual([r.kcal, r.protein, r.fat, r.carbs], [382.4, 20, 10, 24]);
  const two = label.parseLabelText('Per serve Per 100g\nEnergy 300kJ 1000kJ\nProtein 2.0g 6.7g\nFat, total 1.0g 3.3g\nCarbohydrate 10.0g 33.3g');
  assert.deepEqual([two.kcal, two.protein, two.fat, two.carbs], [239, 6.7, 3.3, 33.3]);
  assert.equal(label.parseLabelText('a photo of a cat').readable, false);
});

test('Claude reader sends the image and converts kJ to kcal', async () => {
  let sent;
  const fake = async (url, opts) => {
    sent = { url, headers: opts.headers, body: JSON.parse(opts.body) };
    return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"readable":true,"name":"Rolled Oats","brand":"Uncle Tobys","serving_g":40,"per100":{"kj":1590,"kcal":null,"protein":12.1,"carbs":58.2,"fat":8.1}}' }] }));
  };
  const r = await label.readWithClaude(Buffer.from('fakejpeg'), 'image/jpeg', fake);
  assert.equal(sent.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(sent.headers['anthropic-version'], '2023-06-01');
  assert.equal(sent.body.messages[0].content[0].type, 'image');
  assert.equal(sent.body.messages[0].content[0].source.media_type, 'image/jpeg');
  assert.deepEqual([r.name, r.brand, r.serving_g, r.kcal, r.protein, r.carbs, r.fat], ['Rolled Oats', 'Uncle Tobys', 40, 380, 12.1, 58.2, 8.1]);
  const no = await label.readWithClaude(Buffer.from('x'), 'image/jpeg', async () => new Response(JSON.stringify({ content: [{ type: 'text', text: '{"readable":false}' }] })));
  assert.equal(no.readable, false);
  await assert.rejects(label.readWithClaude(Buffer.from('x'), 'image/jpeg', async () => new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 })), /invalid x-api-key/);
});
