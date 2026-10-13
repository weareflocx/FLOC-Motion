import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { database, transaction } from './database.mjs';
import { requestBody } from './http-boundary.mjs';
import { inspectFont, MAX_FONT_BYTES } from './font-file.mjs';
import { FONT_FILE_TYPES, FONT_STYLES, facesForProject, fontWeightValid, normalizeFontFamily, workspaceFontFile } from '../src/fonts.js';

const failure = (message, status = 400) => Object.assign(new Error(message), { status });
const tooLarge = () => failure('Font files must be 10 MB or smaller.', 413);
const label = face => `${face.family} ${face.weight}${face.style === 'italic' ? ' italic' : ''}`;
const row = item => ({ id: item.id, family: item.family, weight: item.weight, style: item.style, ext: item.ext, fileName: item.file_name, size: item.size, sha256: item.sha256, uploadedBy: item.uploaded_by, createdAt: new Date(item.created_at).toISOString() });

function fields(input, current = {}) {
  const family = input.family === undefined || input.family === null || input.family === '' ? current.family : normalizeFontFamily(input.family);
  const weight = input.weight === undefined || input.weight === null || input.weight === '' ? current.weight : Number(input.weight);
  const style = input.style === undefined || input.style === null || input.style === '' ? current.style : input.style;
  if (!family) throw failure('Name this font family; it could not be read from the file.');
  if (!fontWeightValid(weight)) throw failure('Font weight must be 100–900 in steps of 100.');
  if (!FONT_STYLES.includes(style)) throw failure('Font style must be normal or italic.');
  return { family, weight, style };
}

// The admin-curated workspace font library. Files live in <data>/fonts/<id>.<ext>; rows hold
// the face metadata every editor sees, and font_references blocks deleting a face in use.
export function createFontLibrary({ data, now = Date.now }) {
  const db = database(data), directory = path.join(data, 'fonts');
  const get = id => { const found = db.prepare('SELECT * FROM fonts WHERE id = ?').get(id); if (!found) throw failure('Font not found.', 404); return found; };
  const conflict = (family, weight, style, id = '') => db.prepare('SELECT 1 FROM fonts WHERE family = ? AND weight = ? AND style = ? AND id != ?').get(family, weight, style, id);
  const list = () => db.prepare('SELECT * FROM fonts ORDER BY family, style, weight, created_at').all().map(row);
  // Compositions (including their retained versions) and unsaved drafts that name this face.
  function usage(id) {
    const names = new Set();
    for (const { owner } of db.prepare('SELECT owner FROM font_references WHERE font = ? ORDER BY owner').all(id)) {
      const [kind, key] = owner.split(':');
      if (kind === 'template' || kind === 'version') { const found = db.prepare('SELECT name FROM templates WHERE id = ?').get(key); if (found) names.add(`“${found.name}”`); }
      else if (kind === 'draft') names.add(`an unsaved draft of “${db.prepare("SELECT json_extract(project, '$.name') AS name FROM drafts WHERE id = ?").get(key)?.name || 'Untitled'}”`);
    }
    return [...names];
  }
  return {
    list,
    find: id => { const found = db.prepare('SELECT * FROM fonts WHERE id = ?').get(id); return found ? row(found) : null; },
    path: face => path.join(directory, workspaceFontFile(face)),
    // Faces an export needs: referenced faces plus their family siblings for weight matching.
    facesFor: project => facesForProject(project, list()),
    async upload(req, { name = '', family, weight, style, userId = null } = {}) {
      const ext = path.extname(String(name)).toLowerCase().slice(1);
      if (!Object.hasOwn(FONT_FILE_TYPES, ext)) throw failure('Upload a WOFF2, WOFF, OTF or TTF font file.');
      if (Number(req.headers['content-length']) > MAX_FONT_BYTES) throw tooLarge();
      let bytes;
      try { bytes = await requestBody(req, MAX_FONT_BYTES); }
      catch (error) { throw error.status === 413 ? tooLarge() : error; }
      if (!bytes.length) throw failure('Empty upload.');
      const parsed = inspectFont(bytes, ext);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const duplicate = db.prepare('SELECT * FROM fonts WHERE sha256 = ?').get(sha256);
      if (duplicate) throw failure(`This font file is already in the library as ${label(duplicate)}.`, 409);
      const face = { id: randomUUID(), ext: parsed.ext, ...fields({ family, weight, style }, { family: parsed.family, weight: parsed.weight ?? 400, style: parsed.style }) };
      if (conflict(face.family, face.weight, face.style)) throw failure(`${label(face)} is already in the library. Rename it or choose another family name.`, 409);
      await mkdir(directory, { recursive: true });
      const target = path.join(directory, workspaceFontFile(face)), temporary = `${target}.upload`;
      try {
        await writeFile(temporary, bytes, { flag: 'wx' });
        db.prepare('INSERT INTO fonts (id, family, weight, style, ext, file_name, sha256, size, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(face.id, face.family, face.weight, face.style, face.ext, path.basename(String(name)).slice(0, 200), sha256, bytes.length, userId, now());
        try { await rename(temporary, target); }
        catch (error) { db.prepare('DELETE FROM fonts WHERE id = ?').run(face.id); throw error; }
      } catch (error) {
        await rm(temporary, { force: true });
        if (String(error.message).includes('UNIQUE')) throw failure(`${label(face)} or this exact file is already in the library.`, 409);
        throw error;
      }
      return { ...row(get(face.id)), parsed: { family: parsed.family, subfamily: parsed.subfamily, weight: parsed.weight, style: parsed.style } };
    },
    update(id, input = {}) {
      return transaction(db, () => {
        const current = get(id), next = fields(input, current);
        if (conflict(next.family, next.weight, next.style, id)) throw failure(`${label(next)} is already in the library.`, 409);
        db.prepare('UPDATE fonts SET family = ?, weight = ?, style = ? WHERE id = ?').run(next.family, next.weight, next.style, id);
        return { previous: row(current), font: row(get(id)) };
      });
    },
    async remove(id) {
      const removed = transaction(db, () => {
        const current = get(id), users = usage(id);
        if (users.length) throw failure(`${label(current)} is used by ${users.join(', ')}. Choose another font in ${users.length === 1 ? 'it' : 'them'} first; saved versions count too.`, 409);
        db.prepare('DELETE FROM fonts WHERE id = ?').run(id);
        return row(current);
      });
      await rm(path.join(directory, workspaceFontFile(removed)), { force: true });
      return removed;
    }
  };
}
