import http from 'node:http';
import { readFile, writeFile, mkdir, stat, rename } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { root, runtimeConfig, requestOrigin } from './runtime-config.mjs';
import { demoProject, validateProject, TEMPLATES, SHADERS } from '../src/project.js';
import { catalogSummary } from '../src/catalog.js';
import { startExport, jobs, run } from './export.mjs';
import { ensureGifVideo } from './card-media.mjs';
import { createTemplateStore } from './template-store.mjs';
const config = runtimeConfig();
const { port, data } = config;
const templates = createTemplateStore(data);
await mkdir(path.join(data, 'assets'), { recursive: true });
await mkdir(path.join(data, 'renders'), { recursive: true });
let project = demoProject(); let revision = 0; let writing = false;
try { const saved = JSON.parse(await readFile(path.join(data, 'project.json'), 'utf8')); project = validateProject(saved.project); revision = saved.revision; } catch (e) { if (e.code !== 'ENOENT') console.warn('Saved project is invalid; the demo is loaded.'); }
const vite = process.env.NODE_ENV === 'production' ? null : await (await import('vite')).createServer({ root, server: { middlewareMode: true, watch: { ignored: ['**/.data/**'] } }, appType: 'spa' });
const types = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', html: 'text/html', js: 'text/javascript', css: 'text/css', woff2: 'font/woff2' };
const body = async (req, limit = 2e6) => { let size = 0; const chunks = []; for await (const chunk of req) { size += chunk.length; if (size > limit) throw new Error('File is too large. Maximum upload size is 75 MB.'); chunks.push(chunk); } return Buffer.concat(chunks); };
const json = (res, value, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
async function file(req, res, filename) {
  const info = await stat(filename); const mime = types[path.extname(filename).slice(1)] || 'application/octet-stream';
  const headers = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff' };
  const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  if (range) { const start = Number(range[1]); const end = Math.min(range[2] ? Number(range[2]) : info.size - 1, info.size - 1); if (start >= info.size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); return res.end(); } res.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${info.size}` }); createReadStream(filename, { start, end }).pipe(res); }
  else { res.writeHead(200, { ...headers, 'Content-Length': info.size }); createReadStream(filename).pipe(res); }
}
const server = http.createServer(async (req, res) => {
  try {
    const origin = requestOrigin(req.headers.host, config);
    if (!origin) return json(res, { error: config.publicOrigin ? 'Host not allowed.' : 'Local access only.' }, 403);
    if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin && req.headers.origin !== origin) return json(res, { error: 'Cross-origin mutations are not allowed.' }, 403);
    const url = new URL(req.url, origin); const route = url.pathname;
    if (route === '/api/project' && req.method === 'GET') return json(res, { project, revision });
    if (route === '/api/project' && req.method === 'PUT') {
      const input = JSON.parse(await body(req));
      if (writing || input.revision !== revision) return json(res, { error: 'The project changed in another window. Reload before saving.', project, revision }, 409);
      const next = validateProject(input.project);
      const temp = path.join(data, 'project.tmp.json');
      writing = true;
      try {
        await writeFile(temp, JSON.stringify({ project: next, revision: revision + 1 })); await rename(temp, path.join(data, 'project.json'));
        project = next; revision++; return json(res, { revision });
      } finally { writing = false; }
    }
    if (route === '/api/templates' && req.method === 'GET') return json(res, { templates: await templates.list() });
    if (route === '/api/templates' && req.method === 'POST') return json(res, await templates.create(JSON.parse(await body(req))), 201);
    const templateMatch = route.match(/^\/api\/templates\/([a-f0-9-]{36})$/);
    if (templateMatch && req.method === 'PUT') return json(res, await templates.update(templateMatch[1], JSON.parse(await body(req))));
    if (templateMatch && req.method === 'DELETE') { await templates.remove(templateMatch[1]); return json(res, { deleted: true }); }
    if (route === '/api/catalog') return json(res, { templates: TEMPLATES, shaders: SHADERS, catalog: catalogSummary(), rawCatalog: '/catalog/presets.json' });
    if (route === '/api/health') return json(res, { ok: true, localOnly: !config.publicOrigin, version: '0.1.0' });
    if (route === '/api/assets' && req.method === 'POST') {
      const name = url.searchParams.get('name') || ''; const ext = path.extname(name).toLowerCase().slice(1);
      if (!Object.hasOwn(types, ext) || ['html', 'css', 'js', 'svg', 'woff2'].includes(ext)) return json(res, { error: 'Unsupported upload type.' }, 400);
      const bytes = await body(req, 75e6); if (!bytes.length) throw new Error('Empty upload.');
      const id = randomUUID(); await writeFile(path.join(data, 'assets', `${id}.${ext}`), bytes);
      if (ext === 'gif') await ensureGifVideo(path.join(data, 'assets', `${id}.gif`), path.join(data, 'assets', `${id}.webm`), run);
      return json(res, { id, src: `/assets/${id}.${ext}`, name: path.basename(name).slice(0, 200), type: types[ext] });
    }
    if (route === '/api/exports' && req.method === 'POST') { const input = JSON.parse(await body(req)); return json(res, await startExport(input.project, { draft: input.draft === true }), 202); }
    const jobMatch = route.match(/^\/api\/exports\/([a-f0-9-]{36})$/);
    if (jobMatch) { let job = jobs.get(jobMatch[1]); if (!job) { try { job = JSON.parse(await readFile(path.join(data, 'renders', jobMatch[1], 'job.json'), 'utf8')); } catch {} } return json(res, job || { error: 'Export not found.' }, job ? 200 : 404); }
    const assetMatch = route.match(/^\/assets\/([a-f0-9-]{36}\.(?:png|jpe?g|webp|gif|avif|mp4|webm|mp3|wav|m4a|ogg))$/);
    if (assetMatch) {
      const filename = path.join(data, 'assets', assetMatch[1]);
      if (filename.endsWith('.webm')) {
        try { await stat(filename); } catch {
          const gif = filename.replace(/\.webm$/, '.gif');
          try { await stat(gif); } catch { return json(res, { error: 'Asset not found.' }, 404); }
          await ensureGifVideo(gif, filename, run);
        }
      }
      return await file(req, res, filename);
    }
    const exportMatch = route.match(/^\/exports\/([a-f0-9-]{36})\/video\.mp4$/);
    if (exportMatch) return await file(req, res, path.join(data, 'renders', exportMatch[1], 'video.mp4'));
    // Vite's production bundles share /assets/ with uploaded media.
    if (!vite && route.startsWith('/assets/')) {
      const directory = path.join(root, 'dist', 'assets');
      const filename = path.resolve(directory, decodeURIComponent(route.slice('/assets/'.length)));
      if (!filename.startsWith(directory + path.sep)) return json(res, { error: 'Not found.' }, 404);
      return await file(req, res, filename);
    }
    if (route.startsWith('/api/') || route.startsWith('/assets/') || route.startsWith('/exports/')) return json(res, { error: 'Not found.' }, 404);
    if (vite) return vite.middlewares(req, res);
    const safe = decodeURIComponent(route).replace(/^\/+/, '');
    const filename = path.resolve(root, 'dist', safe || 'index.html');
    if (!filename.startsWith(path.join(root, 'dist') + path.sep)) return json(res, { error: 'Not found.' }, 404);
    try { await file(req, res, filename); } catch { await file(req, res, path.join(root, 'dist/index.html')); }
  } catch (error) { if (!res.headersSent) json(res, { error: error.code === 'ENOENT' ? 'File not found.' : error.message }, error.code === 'ENOENT' ? 404 : 400); else res.destroy(); }
});
server.listen(port, config.host, () => console.log(`FLOC Motion: ${config.publicOrigin || `http://127.0.0.1:${port}`}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); vite?.close(); process.exit(0); });
