// Minimal .xlsx reader: enough to read FSANZ's food composition spreadsheets.
// An .xlsx is a zip of XML files; this unzips it and reads cell values as strings.
const { unzipSync, strFromU8 } = require('fflate');

function decode(s) {
  return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k === 'lt') return '<'; if (k === 'gt') return '>'; if (k === 'amp') return '&'; if (k === 'quot') return '"'; if (k === 'apos') return "'";
    return String.fromCodePoint(k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
  }).replace(/_x000D_/g, '');
}
function texts(xml) {
  // All <t> runs inside a string item, joined (handles rich text).
  let out = '';
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
  let m;
  while ((m = re.exec(xml))) out += m[1];
  return decode(out);
}
function colIndex(ref) {
  const letters = ref.replace(/\d+/g, '');
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function readWorkbook(buf) {
  const files = unzipSync(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
  const get = (p) => (files[p] ? strFromU8(files[p]) : '');
  const shared = [];
  const ss = get('xl/sharedStrings.xml');
  if (ss) {
    const re = /<si>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = re.exec(ss))) shared.push(texts(m[1]));
  }
  const rels = {};
  const relXml = get('xl/_rels/workbook.xml.rels');
  for (const m of relXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0]), target = /Target="([^"]+)"/.exec(m[0]);
    if (id && target) rels[id[1]] = target[1].replace(/^\/?xl\//, '').replace(/^\//, '');
  }
  const sheets = [];
  const wb = get('xl/workbook.xml');
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = /name="([^"]*)"/.exec(m[0]), rid = /r:id="([^"]+)"/.exec(m[0]);
    if (!name || !rid || !rels[rid[1]]) continue;
    const xml = get('xl/' + rels[rid[1]]);
    sheets.push({ name: decode(name[1]), rows: readSheet(xml, shared) });
  }
  return { sheets };
}

function readSheet(xml, shared) {
  const rows = [];
  for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rAttr = /\br="(\d+)"/.exec(rm[1]);
    const rowIdx = rAttr ? Number(rAttr[1]) - 1 : rows.length;
    const row = [];
    for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], body = cm[2] || '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs);
      const t = /\bt="([^"]+)"/.exec(attrs);
      const idx = ref ? colIndex(ref[1]) : row.length;
      let v = '';
      if (t && t[1] === 'inlineStr') v = texts(body);
      else {
        const vm = /<v>([\s\S]*?)<\/v>/.exec(body);
        if (vm) v = t && t[1] === 's' ? shared[Number(vm[1])] || '' : decode(vm[1]);
      }
      row[idx] = v;
    }
    rows[rowIdx] = row;
  }
  return rows.map((r) => (r ? Array.from(r, (x) => (x === undefined ? '' : x)) : []));
}

module.exports = { readWorkbook };
