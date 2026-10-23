// Rebuild server/data/afcd.json from FSANZ's "Nutrient profiles" spreadsheet.
// Usage: node scripts/build-afcd.js "AFCD Release N - Nutrient profiles.xlsx" "Release N"
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'afcd-build-'));
const { parseAfcd } = require('../server/afcd');

const [file, release = 'Release ?'] = process.argv.slice(2);
if (!file) { console.error('Usage: node scripts/build-afcd.js <Nutrient profiles.xlsx> "<Release N>"'); process.exit(1); }
const { foods, sheet } = parseAfcd(fs.readFileSync(file));
const out = {
  source: 'Australian Food Composition Database, Food Standards Australia New Zealand',
  url: 'https://www.foodstandards.gov.au/science-data/food-nutrient-databases/afcd',
  licence: 'CC BY 4.0. Attribution: Food Standards Australia New Zealand.',
  release, sheet, basis: 'per 100 g; kcal = energy with dietary fibre (kJ) / 4.184',
  fields: ['key', 'name', 'kcal', 'protein', 'carbs', 'fat', 'fibre'],
  foods: foods.map((f) => [f.key, f.name, f.kcal, f.protein, f.carbs, f.fat, f.fibre]),
};
const dest = path.join(__dirname, '..', 'server', 'data', 'afcd.json');
fs.writeFileSync(dest, JSON.stringify(out).replace(/\],\[/g, '],\n['));
console.log(`Wrote ${foods.length} foods (${release}) to ${path.relative(process.cwd(), dest)}`);
