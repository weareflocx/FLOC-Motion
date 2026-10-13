import { brotliDecompressSync, inflateSync } from 'node:zlib';
import { FONT_FILE_TYPES } from '../src/fonts.js';

export const MAX_FONT_BYTES = 10 * 1024 * 1024;
// Decompressed WOFF/WOFF2 table data is bounded so a small file cannot expand without limit.
const MAX_TABLE_BYTES = 64 * 1024 * 1024;
const failure = (message, status = 400) => Object.assign(new Error(message), { status });
const damaged = () => failure('This font file is damaged or unsupported.');
// WOFF2 known-table index (WOFF2 specification, section 5.1).
const WOFF2_TAGS = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];

// The container from the magic bytes: wOF2, wOFF, OTTO (CFF outlines) or 0x00010000/'true' (TrueType outlines).
export function fontKind(bytes) {
  if (bytes.length < 12) return null;
  const tag = bytes.toString('latin1', 0, 4);
  if (tag === 'wOF2') return 'woff2';
  if (tag === 'wOFF') return 'woff';
  if (tag === 'OTTO') return 'otf';
  if (tag === 'true' || bytes.readUInt32BE(0) === 0x00010000) return 'ttf';
  return null;
}

function slice(bytes, offset, length) {
  if (offset + length > bytes.length) throw damaged();
  return bytes.subarray(offset, offset + length);
}

function sfntTables(bytes) {
  const count = bytes.readUInt16BE(4), tables = new Map();
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16, entry = slice(bytes, at, 16);
    tables.set(entry.toString('latin1', 0, 4), () => slice(bytes, entry.readUInt32BE(8), entry.readUInt32BE(12)));
  }
  return tables;
}

function woffTables(bytes) {
  if (bytes.length < 44 || bytes.readUInt32BE(4) === 0x74746366) throw damaged();
  const count = bytes.readUInt16BE(12), tables = new Map();
  for (let i = 0; i < count; i++) {
    const entry = slice(bytes, 44 + i * 20, 20);
    const offset = entry.readUInt32BE(4), compressed = entry.readUInt32BE(8), length = entry.readUInt32BE(12);
    if (length > MAX_TABLE_BYTES || compressed > length) throw damaged();
    tables.set(entry.toString('latin1', 0, 4), () => {
      const data = slice(bytes, offset, compressed);
      return compressed < length ? inflateSync(data, { maxOutputLength: length }) : data;
    });
  }
  return tables;
}

function woff2Tables(bytes) {
  if (bytes.length < 48) throw damaged();
  if (bytes.readUInt32BE(4) === 0x74746366) throw failure('Font collections are not supported. Upload one font file per face.');
  const count = bytes.readUInt16BE(12), compressed = bytes.readUInt32BE(20);
  let at = 48;
  const byte = () => { if (at >= bytes.length) throw damaged(); return bytes[at++]; };
  const base128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const next = byte();
      if (i === 0 && next === 0x80) throw damaged();
      value = value * 128 + (next & 0x7f);
      if (value > 0xffffffff) throw damaged();
      if (!(next & 0x80)) return value;
    }
    throw damaged();
  };
  const entries = [];
  for (let i = 0; i < count; i++) {
    const flags = byte();
    const tag = (flags & 0x3f) === 63 ? slice(bytes, (at += 4) - 4, 4).toString('latin1') : WOFF2_TAGS[flags & 0x3f];
    if (!tag) throw damaged();
    const version = flags >> 6, original = base128();
    // glyf and loca are transformed at version 0; every other table only at a non-zero version.
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
    entries.push({ tag, length: transformed ? base128() : original });
  }
  const total = entries.reduce((sum, entry) => sum + entry.length, 0);
  if (total > MAX_TABLE_BYTES) throw damaged();
  let stream;
  try { stream = brotliDecompressSync(slice(bytes, at, compressed), { maxOutputLength: Math.max(1, total) }); }
  catch (error) { if (error.status) throw error; throw damaged(); }
  if (stream.length < total) throw damaged();
  const tables = new Map();
  let offset = 0;
  for (const entry of entries) { const start = offset; tables.set(entry.tag, () => stream.subarray(start, start + entry.length)); offset += entry.length; }
  return tables;
}

const utf16 = raw => Buffer.from(raw.subarray(0, raw.length - raw.length % 2)).swap16().toString('utf16le');
const clean = text => text.replace(/[\u0000-\u001f\u007f"\\<>]/g, '').replace(/\s+/g, ' ').trim();

// Typographic family/subfamily (IDs 16/17) win over the legacy four-style names (1/2);
// Windows US English is preferred, then other Unicode records, then Mac Roman.
function readNames(table) {
  if (!table || table.length < 6) return {};
  const count = table.readUInt16BE(2), storage = table.readUInt16BE(4), found = {};
  for (let i = 0; i < count && 6 + i * 12 + 12 <= table.length; i++) {
    const at = 6 + i * 12;
    const platform = table.readUInt16BE(at), encoding = table.readUInt16BE(at + 2), language = table.readUInt16BE(at + 4);
    const id = table.readUInt16BE(at + 6), length = table.readUInt16BE(at + 8), start = storage + table.readUInt16BE(at + 10);
    if (![1, 2, 16, 17].includes(id) || start + length > table.length) continue;
    const raw = table.subarray(start, start + length);
    let text, rank;
    if (platform === 3 && [0, 1, 10].includes(encoding)) { text = utf16(raw); rank = language === 0x409 ? 0 : 1; }
    else if (platform === 0) { text = utf16(raw); rank = 2; }
    else if (platform === 1 && encoding === 0) { text = raw.toString('latin1'); rank = language === 0 ? 3 : 4; }
    else continue;
    text = clean(text);
    if (text && (!found[id] || rank < found[id].rank)) found[id] = { text, rank };
  }
  return { family: (found[16] ?? found[1])?.text.slice(0, 64), subfamily: (found[17] ?? found[2])?.text };
}

// usWeightClass rounded to a CSS weight; some legacy fonts store 1–9 for 100–900.
export function cssWeight(value) {
  if (!Number.isFinite(value) || value < 1) return 400;
  const weight = value < 10 ? value * 100 : value;
  return Math.min(900, Math.max(100, Math.round(weight / 100) * 100));
}

// Validates the container against the file extension and reads family, weight and style.
// Fields that cannot be read are null; the caller then requires them from the uploader.
export function inspectFont(bytes, ext) {
  if (!Object.hasOwn(FONT_FILE_TYPES, ext)) throw failure('Upload a WOFF2, WOFF, OTF or TTF font file.');
  if (bytes.length > MAX_FONT_BYTES) throw failure('Font files must be 10 MB or smaller.', 413);
  const kind = fontKind(bytes);
  if (!kind) throw failure(bytes.toString('latin1', 0, 4) === 'ttcf' ? 'Font collections are not supported. Upload one font file per face.' : 'This file is not a WOFF2, WOFF, OTF or TTF font.');
  const sfnt = kind === 'otf' || kind === 'ttf';
  if (sfnt ? !['otf', 'ttf'].includes(ext) : kind !== ext) throw failure('Font file content does not match its extension.');
  let tables;
  try { tables = kind === 'woff2' ? woff2Tables(bytes) : kind === 'woff' ? woffTables(bytes) : sfntTables(bytes); }
  catch (error) { if (error.status) throw error; throw damaged(); }
  if (!tables.has('head') || !tables.has('cmap') || !['glyf', 'CFF ', 'CFF2'].some(tag => tables.has(tag))) throw damaged();
  const read = tag => { try { return tables.get(tag)?.() ?? null; } catch { return null; } };
  const { family = null, subfamily = null } = readNames(read('name'));
  const os2 = read('OS/2');
  const weight = os2?.length >= 6 ? cssWeight(os2.readUInt16BE(4)) : null;
  const italic = (os2?.length >= 64 && (os2.readUInt16BE(62) & 0x201) !== 0) || /italic|oblique/i.test(subfamily || '');
  return { ext: kind, family, subfamily, weight, style: italic ? 'italic' : 'normal' };
}
