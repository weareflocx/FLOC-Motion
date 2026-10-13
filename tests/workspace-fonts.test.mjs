import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { deflateSync } from 'node:zlib';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { inspectFont, MAX_FONT_BYTES } from '../server/font-file.mjs';
import { createFontLibrary } from '../server/font-library.mjs';
import { createTemplateStore } from '../server/template-store.mjs';
import { createDraftStore } from '../server/draft-store.mjs';
import { createAuthStore } from '../server/auth-store.mjs';
import { prepareComposition } from '../server/export.mjs';
import { demoProject, patchLayer, validateProject } from '../src/project.js';
import { stageMarkup } from '../src/scene.js';
import { facesForProject, fontFaceCss, validateFontFaces, workspaceFamilies, workspaceFontFaceCss } from '../src/fonts.js';

const bundled = name => readFile(new URL(`../public/fonts/${name}`, import.meta.url));
const temporary = async t => { const folder = await mkdtemp(path.join(tmpdir(), 'floc-fonts-')); t.after(() => rm(folder, { recursive: true, force: true })); return folder; };
const upload = (bytes, headers = {}) => Object.assign(Readable.from([bytes]), { headers });

// Minimal OpenType containers: the parser needs the table directory plus name and OS/2.
function nameTable(family, subfamily) {
  const strings = [family, subfamily].map(text => Buffer.from(text, 'utf16le').swap16());
  const table = Buffer.alloc(6 + 12 * strings.length);
  table.writeUInt16BE(strings.length, 2); table.writeUInt16BE(table.length, 4);
  let offset = 0;
  strings.forEach((value, i) => {
    const at = 6 + i * 12;
    table.writeUInt16BE(3, at); table.writeUInt16BE(1, at + 2); table.writeUInt16BE(0x409, at + 4);
    table.writeUInt16BE(i ? 2 : 1, at + 6); table.writeUInt16BE(value.length, at + 8); table.writeUInt16BE(offset, at + 10);
    offset += value.length;
  });
  return Buffer.concat([table, ...strings]);
}
function os2(weight, italic = false) {
  const table = Buffer.alloc(78);
  table.writeUInt16BE(4, 0); table.writeUInt16BE(weight, 4); table.writeUInt16BE(italic ? 1 : 0x40, 62);
  return table;
}
const fontTables = (family, subfamily, weight, italic, outlines = 'glyf') => [['OS/2', os2(weight, italic)], ['cmap', Buffer.alloc(4)], [outlines, Buffer.alloc(8)], ['head', Buffer.alloc(54)], ['name', nameTable(family, subfamily)]];
function sfnt(flavor, tables) {
  const header = Buffer.alloc(12 + tables.length * 16), bodies = [];
  header.writeUInt32BE(flavor, 0); header.writeUInt16BE(tables.length, 4);
  let offset = header.length;
  tables.forEach(([tag, data], i) => {
    const at = 12 + i * 16;
    header.write(tag, at, 'latin1'); header.writeUInt32BE(offset, at + 8); header.writeUInt32BE(data.length, at + 12);
    const padded = Buffer.concat([data, Buffer.alloc((4 - data.length % 4) % 4)]);
    bodies.push(padded); offset += padded.length;
  });
  return Buffer.concat([header, ...bodies]);
}
function woff(flavor, tables) {
  const header = Buffer.alloc(44 + tables.length * 20), bodies = [];
  header.write('wOFF', 0, 'latin1'); header.writeUInt32BE(flavor, 4); header.writeUInt16BE(tables.length, 12);
  let offset = header.length;
  tables.forEach(([tag, data], i) => {
    const compressed = deflateSync(data), stored = compressed.length < data.length ? compressed : data, at = 44 + i * 20;
    header.write(tag, at, 'latin1'); header.writeUInt32BE(offset, at + 4); header.writeUInt32BE(stored.length, at + 8); header.writeUInt32BE(data.length, at + 12);
    const padded = Buffer.concat([stored, Buffer.alloc((4 - stored.length % 4) % 4)]);
    bodies.push(padded); offset += padded.length;
  });
  header.writeUInt32BE(offset, 8);
  return Buffer.concat([header, ...bodies]);
}

test('font uploads are recognized by magic bytes and their names, weight and style are read', async () => {
  assert.deepEqual(inspectFont(await bundled('geist-700.woff2'), 'woff2'), { ext: 'woff2', family: 'Geist', subfamily: 'Bold', weight: 700, style: 'normal' });
  const ttf = sfnt(0x00010000, fontTables('Brand Sans', 'Light Italic', 300, true));
  assert.deepEqual(inspectFont(ttf, 'ttf'), { ext: 'ttf', family: 'Brand Sans', subfamily: 'Light Italic', weight: 300, style: 'italic' });
  // An OTF name holding TrueType outlines is still OpenType; it is stored by its real container.
  assert.equal(inspectFont(ttf, 'otf').ext, 'ttf');
  assert.equal(inspectFont(sfnt(0x4f54544f, fontTables('Brand Serif', 'Black', 900, false, 'CFF ')), 'otf').weight, 900);
  const compressed = woff(0x00010000, fontTables('Brand Mono', 'Medium', 500, false));
  assert.deepEqual(inspectFont(compressed, 'woff'), { ext: 'woff', family: 'Brand Mono', subfamily: 'Medium', weight: 500, style: 'normal' });
  const rejects = (bytes, ext, pattern) => assert.throws(() => inspectFont(bytes, ext), error => error.status >= 400 && pattern.test(error.message), pattern.source);
  rejects(compressed, 'woff2', /does not match its extension/);
  rejects(await bundled('geist-700.woff2'), 'ttf', /does not match its extension/);
  rejects(Buffer.from('<!doctype html><html><body>not a font</body></html>'), 'woff2', /not a WOFF2, WOFF, OTF or TTF/);
  rejects(Buffer.concat([Buffer.from('ttcf'), Buffer.alloc(64)]), 'ttf', /collections are not supported/);
  rejects(ttf, 'svg', /Upload a WOFF2, WOFF, OTF or TTF/);
  rejects(ttf.subarray(0, 40), 'ttf', /damaged or unsupported/);
  rejects(sfnt(0x00010000, fontTables('No Outlines', 'Regular', 400, false).filter(([tag]) => tag !== 'glyf')), 'ttf', /damaged or unsupported/);
  const truncated = await bundled('geist-mono-500.woff2');
  rejects(truncated.subarray(0, truncated.length - 200), 'woff2', /damaged or unsupported/);
});

test('the font library rejects oversize and duplicate files and only deletes unused faces', async t => {
  const data = await temporary(t);
  const library = createFontLibrary({ data, now: () => Date.UTC(2026, 9, 13) });
  await assert.rejects(library.upload(upload(Buffer.alloc(8), { 'content-length': String(MAX_FONT_BYTES + 1) }), { name: 'big.woff2' }), error => error.status === 413 && /10 MB/.test(error.message));
  await assert.rejects(library.upload(upload(Buffer.alloc(MAX_FONT_BYTES + 1)), { name: 'big.ttf' }), error => error.status === 413);
  await assert.rejects(library.upload(upload(Buffer.from('x')), { name: 'font.css' }), error => error.status === 400);
  // Re-uploaded studio files get their own family, so they never collide with the bundled fonts.
  const display = await library.upload(upload(await bundled('druk-wide-heavy.woff2')), { name: 'druk-wide-heavy.woff2', family: 'Test Display', userId: 'admin' });
  assert.deepEqual([display.family, display.weight, display.style, display.ext, display.parsed.family], ['Test Display', 800, 'normal', 'woff2', 'Druk Wide Web']);
  await assert.rejects(library.upload(upload(await bundled('druk-wide-heavy.woff2')), { name: 'copy.woff2', family: 'Other' }), error => error.status === 409 && /already in the library as Test Display 800/.test(error.message));
  await assert.rejects(library.upload(upload(await bundled('geist-800.woff2')), { name: 'geist-800.woff2', family: 'Test Display' }), error => error.status === 409 && /Test Display 800 is already/.test(error.message));
  const regular = await library.upload(upload(await bundled('geist-400.woff2')), { name: 'geist-400.woff2', family: 'Test Display' });
  await assert.rejects(library.upload(upload(sfnt(0x00010000, fontTables('', '', 400, false))), { name: 'unnamed.ttf' }), /Name this font family/);
  assert.deepEqual(library.list().map(face => [face.family, face.weight]), [['Test Display', 400], ['Test Display', 800]]);
  assert.deepEqual((await readdir(path.join(data, 'fonts'))).sort(), [`${display.id}.woff2`, `${regular.id}.woff2`].sort());

  assert.throws(() => library.update(regular.id, { weight: 800 }), error => error.status === 409);
  assert.throws(() => library.update(regular.id, { family: 'Bad "name"' }), /quotes/);
  assert.equal(library.update(regular.id, { family: 'Test Text', style: 'italic' }).font.family, 'Test Text');

  const using = patchLayer(demoProject(), 'headline', { font: `workspace:${display.id}`, weight: 800 });
  const composition = await createTemplateStore(data).create({ name: 'Launch teaser', tags: [], project: using }, {});
  await assert.rejects(library.remove(display.id), error => error.status === 409 && /used by “Launch teaser”/.test(error.message));
  const draft = randomUUID();
  await createDraftStore(data).update(draft, { revision: 0, project: patchLayer({ ...demoProject(), name: 'Draft cut' }, 'signature', { font: `workspace:${regular.id}`, weight: 400 }) });
  await assert.rejects(library.remove(regular.id), error => error.status === 409 && /unsaved draft of “Draft cut”/.test(error.message));
  await createDraftStore(data).update(draft, { revision: 1, project: demoProject() });
  assert.equal((await library.remove(regular.id)).id, regular.id);
  await assert.rejects(stat(path.join(data, 'fonts', `${regular.id}.woff2`)), { code: 'ENOENT' });
  // Retained versions keep a face in use until the composition itself is deleted.
  await createTemplateStore(data).remove(composition.id);
  await library.remove(display.id);
  assert.deepEqual(library.list(), []);
  await assert.rejects(library.remove(display.id), error => error.status === 404);
});

test('text layers accept workspace font ids; rendering aliases them with a Geist fallback', () => {
  const id = randomUUID();
  const project = patchLayer(demoProject(), 'headline', { font: `workspace:${id}`, weight: 300 });
  assert.equal(validateProject(JSON.parse(JSON.stringify(project))).layers.find(layer => layer.id === 'headline').font, `workspace:${id}`);
  assert.match(stageMarkup(project), new RegExp(`font-family:floc-workspace-${id},Geist;font-weight:300`));
  for (const font of ['workspace:', 'workspace:../../etc', `workspace:${id.toUpperCase()}`, `Workspace:${id}`, `workspace:${id}"`]) assert.throws(() => patchLayer(demoProject(), 'headline', { font, weight: 400 }), /Unknown text style/, font);
  assert.throws(() => patchLayer(demoProject(), 'headline', { font: `workspace:${id}`, weight: 450 }), /Unknown text style/);
  assert.throws(() => patchLayer(demoProject(), 'headline', { font: 'geist', weight: 300 }), /Unknown text style/, 'bundled fonts keep their own weights');
  // Font matching picks the nearest weight among one family and style; other styles stay apart.
  const faces = [
    { id: randomUUID(), family: 'Brand', weight: 400, style: 'normal', ext: 'woff2' },
    { id: randomUUID(), family: 'Brand', weight: 700, style: 'normal', ext: 'ttf' },
    { id: randomUUID(), family: 'Brand', weight: 400, style: 'italic', ext: 'otf' },
    { id: randomUUID(), family: 'Other', weight: 400, style: 'normal', ext: 'woff' }
  ];
  const needed = facesForProject(patchLayer(demoProject(), 'headline', { font: `workspace:${faces[1].id}`, weight: 700 }), faces);
  assert.deepEqual(needed.map(face => face.id), [faces[0].id, faces[1].id]);
  const css = workspaceFontFaceCss(needed, face => `./fonts/${face.id}.${face.ext}`);
  assert.equal((css.match(new RegExp(`font-family:"floc-workspace-${faces[1].id}"`, 'g')) || []).length, 2);
  assert.match(css, new RegExp(`font-weight:700;src:url\\("./fonts/${faces[1].id}.ttf"\\) format\\("truetype"\\)`));
  assert.deepEqual(workspaceFamilies(faces).map(group => [group.family, group.style, group.faces.length]), [['Brand', 'normal', 2], ['Brand', 'italic', 1], ['Other', 'normal', 1]]);
  assert.throws(() => validateFontFaces([{ ...faces[0], ext: 'svg' }]), /Invalid workspace font/);
  assert.throws(() => validateFontFaces([{ ...faces[0], id: '../escape' }]), /Invalid workspace font/);
});

test('exports copy referenced workspace font files and declare them with relative URLs', { timeout: 120000 }, async t => {
  const data = await temporary(t), previous = process.env.FLOC_DATA_DIR;
  process.env.FLOC_DATA_DIR = data;
  t.after(() => { if (previous === undefined) delete process.env.FLOC_DATA_DIR; else process.env.FLOC_DATA_DIR = previous; });
  const library = createFontLibrary({ data });
  const regular = await library.upload(upload(await bundled('geist-mono-500.woff2')), { name: 'mono-500.woff2', family: 'Export Mono' });
  const bold = await library.upload(upload(await bundled('geist-mono-700.woff2')), { name: 'mono-700.woff2', family: 'Export Mono' });
  const unused = await library.upload(upload(await bundled('geist-600.woff2')), { name: 'unused.woff2', family: 'Unused' });
  const project = patchLayer(demoProject(), 'headline', { font: `workspace:${bold.id}`, weight: 700 });
  const folder = path.join(data, 'export');
  await prepareComposition(project, folder, {}, undefined, library.list());
  assert.deepEqual((await readdir(path.join(folder, 'fonts'))).sort(), [`${regular.id}.woff2`, `${bold.id}.woff2`].sort());
  assert.deepEqual(await readFile(path.join(folder, 'fonts', `${bold.id}.woff2`)), await bundled('geist-mono-700.woff2'));
  const html = await readFile(path.join(folder, 'index.html'), 'utf8');
  assert.ok(html.includes(fontFaceCss('./')), 'studio fonts are declared as before');
  assert.ok(html.includes(`@font-face{font-family:"floc-workspace-${bold.id}";font-style:normal;font-weight:700;src:url("./fonts/${bold.id}.woff2") format("woff2");font-display:block}`));
  assert.ok(html.includes(`src:url("./fonts/${regular.id}.woff2")`), 'family siblings are declared for weight matching');
  assert.ok(!html.includes(unused.id), 'unreferenced faces stay out of the export');
  assert.ok(html.includes(`font-family:floc-workspace-${bold.id},Geist`));
  assert.deepEqual(JSON.parse(await readFile(path.join(folder, 'render-input.json'), 'utf8')).fonts.map(face => face.id).sort(), [regular.id, bold.id].sort());
  // Studio-only projects prepare exactly as before.
  const plain = path.join(data, 'plain');
  await prepareComposition(demoProject(), plain, {}, undefined, library.list());
  await assert.rejects(stat(path.join(plain, 'fonts')), { code: 'ENOENT' });
  assert.ok(!(await readFile(path.join(plain, 'index.html'), 'utf8')).includes('floc-workspace-'));
});

test('HTTP: only admins change the font library; signed-in users and renderers read font files', { timeout: 30000 }, async t => {
  const data = await temporary(t);
  const invitation = await createAuthStore(data).bootstrap('admin@example.com');
  const listener = createServer();
  listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const origin = `http://127.0.0.1:${port}`, workerToken = 'test-only-shared-renderer-credential';
  const server = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, NODE_ENV: 'production', PORT: String(port), FLOC_DATA_DIR: data, FLOC_PUBLIC_ORIGIN: '', FLOC_RENDER_WORKER_TOKEN: workerToken }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (server.exitCode === null) { server.kill('SIGTERM'); await once(server, 'exit'); } });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Test server did not start.')), 15000);
    server.stdout.on('data', chunk => { if (String(chunk).includes('FLOC Motion:')) { clearTimeout(timer); resolve(); } });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Test server exited (${code}).`)); });
  });
  const call = (route, { cookie, method = 'GET', body, json, authorization } = {}) => fetch(origin + route, {
    method, headers: { ...(cookie && { Cookie: cookie }), ...(authorization && { Authorization: authorization }), ...(method !== 'GET' && { Origin: origin }), ...(json && { 'Content-Type': 'application/json' }) },
    ...(json ? { body: JSON.stringify(json) } : body ? { body } : {})
  });
  const accept = async (details, secret) => {
    const response = await call('/api/auth/accept', { method: 'POST', json: { email: details.email, password: secret, token: details.token } });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  };
  const admin = await accept(invitation, 'Admin test password');
  const sent = await (await call('/api/auth/invitations', { cookie: admin, method: 'POST', json: { email: 'editor@example.com', role: 'editor' } })).json();
  const editor = await accept({ email: sent.email, token: new URLSearchParams(new URL(sent.url).hash.slice(1)).get('invite') }, 'Editor test password');
  const woff2 = await bundled('geist-mono-700.woff2');

  assert.equal((await call('/api/fonts')).status, 401);
  assert.equal((await call('/api/fonts?name=mono.woff2', { cookie: editor, method: 'POST', body: woff2 })).status, 403);
  assert.equal((await call('/api/fonts?name=mono.ttf', { cookie: admin, method: 'POST', body: woff2 })).status, 400, 'content must match the extension');
  assert.equal((await call('/api/fonts?name=page.woff2', { cookie: admin, method: 'POST', body: '<html>' })).status, 400);
  const created = await call('/api/fonts?name=mono.woff2&family=Brand%20Mono', { cookie: admin, method: 'POST', body: woff2 });
  assert.equal(created.status, 201);
  const { font } = await created.json();
  assert.deepEqual([font.family, font.weight, font.style], ['Brand Mono', 700, 'normal']);
  assert.equal((await call('/api/fonts?name=again.woff2', { cookie: admin, method: 'POST', body: woff2 })).status, 409);
  assert.deepEqual((await (await call('/api/fonts', { cookie: editor })).json()).fonts.map(face => face.id), [font.id]);

  const route = `/fonts/workspace/${font.id}.woff2`;
  assert.equal((await call(route)).status, 401);
  for (const access of [{ cookie: editor }, { authorization: `Bearer ${workerToken}` }]) {
    const response = await call(route, access);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'font/woff2');
    assert.match(response.headers.get('cache-control'), /private/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), woff2);
  }
  assert.equal((await call(`/fonts/workspace/${font.id}.ttf`, { cookie: editor })).status, 404);

  for (const [method, json] of [['PATCH', { family: 'Renamed' }], ['DELETE']]) assert.equal((await call(`/api/fonts/${font.id}`, { cookie: editor, method, json })).status, 403, method);
  const renamed = await call(`/api/fonts/${font.id}`, { cookie: admin, method: 'PATCH', json: { family: 'Studio Mono', weight: 600 } });
  assert.deepEqual(await renamed.json().then(value => [value.font.family, value.font.weight]), ['Studio Mono', 600]);
  const saved = await call('/api/templates', { cookie: editor, method: 'POST', json: { name: 'Uses mono', tags: [], project: patchLayer(demoProject(), 'headline', { font: `workspace:${font.id}`, weight: 600 }) } });
  const blocked = await call(`/api/fonts/${font.id}`, { cookie: admin, method: 'DELETE' });
  assert.equal(blocked.status, 409);
  assert.match((await blocked.json()).error, /“Uses mono”/);
  assert.equal((await call(`/api/templates/${(await saved.json()).id}`, { cookie: editor, method: 'DELETE' })).status, 200);
  assert.equal((await call(`/api/fonts/${font.id}`, { cookie: admin, method: 'DELETE' })).status, 200);
  assert.equal((await call(route, { cookie: editor })).status, 404);
  const actions = (await (await call('/api/audit', { cookie: admin })).json()).entries.filter(entry => entry.target?.type === 'font').map(entry => entry.action);
  assert.deepEqual(actions, ['font.deleted', 'font.renamed', 'font.uploaded']);
});
