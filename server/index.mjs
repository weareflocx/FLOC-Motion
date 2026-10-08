import { validateSvg, validateGlb } from './asset-validation.mjs';
import http from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { root, runtimeConfig, requestOrigin } from './runtime-config.mjs';
import { TEMPLATES, SHADERS, CAROUSEL_EFFECTS } from '../src/project.js';
import { catalogSummary } from '../src/catalog.js';
import { startExport, jobs, run } from './export.mjs';
import { ensureGifVideo } from './card-media.mjs';
import { createTemplateStore } from './template-store.mjs';
import { createRenderWorker } from './render-worker.mjs';
import { createPersonalRenderers, rendererCookie } from './personal-renderers.mjs';
import { rendererVersion } from './renderer-version.mjs';
import { createAuthStore, sessionCookie } from './auth-store.mjs';
import { createDraftStore } from './draft-store.mjs';
const config = runtimeConfig();
const { port, data } = config;
const templates = createTemplateStore(data);
await templates.preserveLegacyProject();
const auth = createAuthStore(data);
const drafts = createDraftStore(data);
const renderWorker = createRenderWorker({ data, jobs, token: process.env.FLOC_RENDER_WORKER_TOKEN });
const personalRenderers = createPersonalRenderers({ data, jobs, version: await rendererVersion() });
await mkdir(path.join(data, 'assets'), { recursive: true });
await mkdir(path.join(data, 'renders'), { recursive: true });
const vite = process.env.NODE_ENV === 'production' ? null : await (await import('vite')).createServer({ root, server: { middlewareMode: true, watch: { ignored: ['**/.data/**'] }, fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.data/**', `${data}/**`] } }, appType: 'spa' });
const types = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml', glb: 'model/gltf-binary', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', html: 'text/html', js: 'text/javascript', css: 'text/css', woff2: 'font/woff2' };
const body = async (req, limit = 2e6) => { let size = 0; const chunks = []; for await (const chunk of req) { size += chunk.length; if (size > limit) throw new Error('File is too large. Maximum upload size is 75 MB.'); chunks.push(chunk); } return Buffer.concat(chunks); };
const json = (res, value, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
async function file(req, res, filename) {
  const info = await stat(filename); const mime = types[path.extname(filename).slice(1)] || 'application/octet-stream';
  const headers = { ...(mime === 'image/svg+xml' ? { 'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'" } : {}), 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff' };
  if (filename.startsWith(data + path.sep)) Object.assign(headers, { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization' });
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
    if (route === '/api/health') return json(res, { ok: true, localOnly: !config.publicOrigin, version: '0.1.0' });
    if (route === '/api/auth/session' && req.method === 'GET') return json(res, { user: await auth.user(req.headers.cookie) });
    if (['/api/auth/login', '/api/auth/accept', '/api/auth/logout'].includes(route) && req.method === 'POST') {
      if (req.headers.origin !== origin) return json(res, { error: 'A same-origin request is required.' }, 403);
      if (route === '/api/auth/logout') {
        await auth.logout(req.headers.cookie);
        res.setHeader('Set-Cookie', sessionCookie('', origin.startsWith('https:'), true));
        return json(res, { user: null });
      }
      const input = JSON.parse(await body(req, 4096));
      const result = await auth[route.endsWith('login') ? 'login' : 'accept'](input, req.socket.remoteAddress);
      res.setHeader('Set-Cookie', sessionCookie(result.token, origin.startsWith('https:')));
      return json(res, { user: result.user });
    }
    if (route === '/api/renderers/connect' && req.method === 'POST') return json(res, await personalRenderers.finishPairing(JSON.parse(await body(req))));
    if (route.startsWith('/api/render-worker/')) {
      const device = await personalRenderers.engine(req.headers.authorization);
      if (device) {
        if (route === '/api/render-worker/claim' && req.method === 'POST') return json(res, await personalRenderers.claim(device, JSON.parse(await body(req))));
        const match = route.match(/^\/api\/render-worker\/([a-f0-9-]{36})\/(progress|result)$/);
        if (match && req.method === 'POST') return json(res, await personalRenderers[match[2] === 'result' ? 'complete' : 'update'](device, match[1], JSON.parse(await body(req))));
        return json(res, { error: 'Not found.' }, 404);
      }
      if (!renderWorker.authorize(req.headers.authorization)) return json(res, { error: 'Renderer authentication required.' }, 401);
      if (route === '/api/render-worker/claim' && req.method === 'POST') return json(res, await renderWorker.claim());
      const workerJob = route.match(/^\/api\/render-worker\/([a-f0-9-]{36})\/(progress|result)$/);
      if (workerJob && req.method === 'POST') return json(res, workerJob[2] === 'result' ? await renderWorker.complete(workerJob[1], req) : await renderWorker.update(workerJob[1], JSON.parse(await body(req))));
      return json(res, { error: 'Not found.' }, 404);
    }
    const user = await auth.user(req.headers.cookie);
    const privateAsset = /^\/assets\/[a-f0-9-]{36}\.(?:png|jpe?g|webp|gif|avif|mp4|webm|mp3|wav|m4a|ogg|svg|glb)$/.test(route);
    const workerRead = req.method === 'GET' && (privateAsset || /^\/api\/exports\/[a-f0-9-]{36}$/.test(route));
    const renderer = !user && workerRead && (await personalRenderers.engine(req.headers.authorization) || renderWorker.authorize(req.headers.authorization));
    if ((route.startsWith('/api/') || privateAsset || route.startsWith('/exports/')) && !user && !renderer) return json(res, { error: 'Sign in to continue.' }, 401);
    if (user && !['GET', 'HEAD'].includes(req.method) && req.headers.origin !== origin) return json(res, { error: 'A same-origin request is required.' }, 403);
    if (route === '/api/auth/invitations' && req.method === 'POST') {
      const invitation = await auth.invite(JSON.parse(await body(req, 4096)).email);
      return json(res, { email: invitation.email, expiresAt: invitation.expiresAt, url: `${origin}/#invite=${invitation.token}` }, 201);
    }
    if (route === '/api/renderers/status' && req.method === 'GET') return json(res, { required: Boolean(config.publicOrigin), ...await personalRenderers.status(await personalRenderers.browser(req.headers.cookie)) });
    if (route === '/api/renderers/pair' && req.method === 'POST') {
      const pairing = await personalRenderers.startPairing(req.headers.cookie);
      res.setHeader('Set-Cookie', rendererCookie(pairing.key, origin.startsWith('https:')));
      return json(res, { code: pairing.code, expiresAt: pairing.expiresAt }, 201);
    }
    const draftMatch = route.match(/^\/api\/drafts\/([a-f0-9-]{36})$/);
    if (draftMatch && req.method === 'GET') return json(res, await drafts.read(draftMatch[1]));
    if (draftMatch && req.method === 'PUT') return json(res, await drafts.update(draftMatch[1], JSON.parse(await body(req))));
    if (route === '/api/templates' && req.method === 'GET') return json(res, { templates: await templates.list() });
    if (route === '/api/templates' && req.method === 'POST') return json(res, await templates.create(JSON.parse(await body(req))), 201);
    const templateMatch = route.match(/^\/api\/templates\/([a-f0-9-]{36})$/);
    if (templateMatch && req.method === 'GET') return json(res, await templates.read(templateMatch[1]));
    if (templateMatch && req.method === 'PUT') return json(res, await templates.update(templateMatch[1], JSON.parse(await body(req))));
    if (templateMatch && req.method === 'DELETE') { await templates.remove(templateMatch[1]); return json(res, { deleted: true }); }
    if (route === '/api/catalog') return json(res, { templates: TEMPLATES, shaders: SHADERS, carouselEffects: CAROUSEL_EFFECTS, catalog: catalogSummary(), rawCatalog: '/catalog/presets.json' });
    if (route === '/api/assets' && req.method === 'POST') {
      const name = url.searchParams.get('name') || ''; const ext = path.extname(name).toLowerCase().slice(1);
      if (!Object.hasOwn(types, ext) || ['html', 'css', 'js', 'woff2'].includes(ext)) return json(res, { error: 'Unsupported upload type.' }, 400);
      const bytes = await body(req, 75e6); if (!bytes.length) throw new Error('Empty upload.');
      if (ext === 'svg') validateSvg(bytes);
      if (ext === 'glb') validateGlb(bytes);
      const id = randomUUID(); await writeFile(path.join(data, 'assets', `${id}.${ext}`), bytes);
      if (ext === 'gif') await ensureGifVideo(path.join(data, 'assets', `${id}.gif`), path.join(data, 'assets', `${id}.webm`), run);
      return json(res, { id, src: `/assets/${id}.${ext}`, name: path.basename(name).slice(0, 200), type: types[ext] });
    }
    if (route === '/api/exports' && req.method === 'POST') {
      const input = JSON.parse(await body(req));
      const device = await personalRenderers.browser(req.headers.cookie);
      if (device) return json(res, await personalRenderers.enqueue(device, input.project, input.settings), 202);
      if (config.publicOrigin) return json(res, { error: 'Connect this computer’s renderer in Export before rendering.' }, 503);
      return json(res, await (renderWorker.enabled ? renderWorker.enqueue(input.project, input.settings) : startExport(input.project, input.settings)), 202);
    }
    const jobMatch = route.match(/^\/api\/exports\/([a-f0-9-]{36})$/);
    if (jobMatch) {
      const device = await personalRenderers.browser(req.headers.cookie) || await personalRenderers.engine(req.headers.authorization);
      let job = await personalRenderers.job(device, jobMatch[1]);
      if (!job?.rendererId) job = await renderWorker.status(jobMatch[1]) || job;
      if (!job) {
        try {
          const filename = path.join(data, 'renders', jobMatch[1], 'job.json');
          job = JSON.parse(await readFile(filename, 'utf8'));
          if (renderWorker.enabled && !['done', 'failed'].includes(job.state)) {
            Object.assign(job, { state: 'failed', message: 'The editor restarted during export. Please export again.' });
            await writeFile(filename, JSON.stringify(job));
          }
        } catch {}
      }
      return json(res, job || { error: 'Export not found.' }, job ? 200 : 404);
    }
    const assetMatch = route.match(/^\/assets\/([a-f0-9-]{36}\.(?:png|jpe?g|webp|gif|avif|mp4|webm|mp3|wav|m4a|ogg|svg|glb))$/);
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
    if (exportMatch) {
      const device = await personalRenderers.browser(req.headers.cookie);
      await personalRenderers.job(device, exportMatch[1]);
      return await file(req, res, path.join(data, 'renders', exportMatch[1], 'video.mp4'));
    }
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
  } catch (error) { if (!res.headersSent) json(res, { error: error.code === 'ENOENT' ? 'File not found.' : error.message }, error.status || (error.code === 'ENOENT' ? 404 : 400)); else res.destroy(); }
});
server.listen(port, config.host, () => console.log(`FLOC Motion: ${config.publicOrigin || `http://127.0.0.1:${port}`}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); vite?.close(); process.exit(0); });
