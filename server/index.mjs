import http from 'node:http';
import { mkdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { root, runtimeConfig, requestOrigin } from './runtime-config.mjs';
import { TEMPLATES } from '../src/project.js';
import { EFFECTS } from '../src/effects.js';
import { CURRENT_PROJECT_VERSION } from '../src/project-migrations.js';
import { catalogSummary } from '../src/catalog.js';
import { startExport, cancelExport, recoverInterruptedJobs, listJobs, jobs, run, onExportEnded } from './export.mjs';
import { isTerminalJobState } from '../src/export-jobs.js';
import { EXPORT_FORMATS } from '../src/export-settings.js';
import { ensureGifVideo } from './card-media.mjs';
import { createTemplateStore } from './template-store.mjs';
import { createRenderWorker } from './render-worker.mjs';
import { createPersonalRenderers, rendererCookie } from './personal-renderers.mjs';
import { rendererVersion } from './renderer-version.mjs';
import { createAuthStore, sessionCookie } from './auth-store.mjs';
import { createAuditLog } from './audit-log.mjs';
import { createDraftStore } from './draft-store.mjs';
import { removeStaleJsonTemps } from './json-store.mjs';
import { clientAddress, configureHttpServer, requestBody } from './http-boundary.mjs';
import { createAssetStorage } from './asset-storage.mjs';
import { createFontLibrary } from './font-library.mjs';
import { FONT_FILE_TYPES } from '../src/fonts.js';
const config = runtimeConfig();
const { port, data } = config;
const assets = path.join(data, 'assets');
const storage = createAssetStorage({ data });
const templates = createTemplateStore(data);
await templates.preserveLegacyProject();
const auth = createAuthStore(data);
const audit = createAuditLog(data);
onExportEnded(job => audit.exportEnded(job));
const drafts = createDraftStore(data);
const fonts = createFontLibrary({ data });
const renderWorker = createRenderWorker({ data, jobs, token: process.env.FLOC_RENDER_WORKER_TOKEN });
const personalRenderers = createPersonalRenderers({ data, jobs, version: await rendererVersion() });
await mkdir(assets, { recursive: true });
await mkdir(path.join(data, 'renders'), { recursive: true });
await removeStaleJsonTemps(path.join(data, 'renders'), { recursive: true });
await recoverInterruptedJobs(data);
const vite = process.env.NODE_ENV === 'production' ? null : await (await import('vite')).createServer({ root, server: { middlewareMode: true, watch: { ignored: ['**/.data/**'] }, fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.data/**', `${data}/**`] } }, appType: 'spa' });
const types = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml', glb: 'model/gltf-binary', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', html: 'text/html', js: 'text/javascript', css: 'text/css', woff2: 'font/woff2' };
const body = requestBody;
const json = (res, value, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
async function file(req, res, filename, type) {
  const info = await stat(filename); const mime = type || types[path.extname(filename).slice(1)] || 'application/octet-stream';
  const headers = { ...(mime === 'image/svg+xml' ? { 'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'" } : {}), 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff' };
  if (mime === 'text/html') headers['Cache-Control'] = 'no-store';
  if (filename.startsWith(data + path.sep)) Object.assign(headers, { 'Cache-Control': 'private, no-store', Vary: 'Cookie, Authorization' });
  const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  if (range) { const start = Number(range[1]); const end = Math.min(range[2] ? Number(range[2]) : info.size - 1, info.size - 1); if (start >= info.size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); return res.end(); } res.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${info.size}` }); createReadStream(filename, { start, end }).pipe(res); }
  else { res.writeHead(200, { ...headers, 'Content-Length': info.size }); createReadStream(filename).pipe(res); }
}
const server = configureHttpServer(http.createServer(async (req, res) => {
  try {
    const origin = requestOrigin(req.headers.host, config);
    if (!origin) return json(res, { error: config.publicOrigin ? 'Host not allowed.' : 'Local access only.' }, 403);
    if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin && req.headers.origin !== origin) return json(res, { error: 'Cross-origin mutations are not allowed.' }, 403);
    const url = new URL(req.url, origin); const route = url.pathname;
    if (route === '/api/health') return json(res, { ok: true, localOnly: !config.publicOrigin, version: '0.1.0', projectVersion: CURRENT_PROJECT_VERSION });
    if (route === '/api/auth/session' && req.method === 'GET') return json(res, { user: await auth.user(req.headers.cookie), projectVersion: CURRENT_PROJECT_VERSION });
    if (['/api/auth/login', '/api/auth/accept', '/api/auth/logout'].includes(route) && req.method === 'POST') {
      if (req.headers.origin !== origin) return json(res, { error: 'A same-origin request is required.' }, 403);
      if (route === '/api/auth/logout') {
        await auth.logout(req.headers.cookie);
        res.setHeader('Set-Cookie', sessionCookie('', origin.startsWith('https:'), true));
        return json(res, { user: null });
      }
      const input = JSON.parse(await body(req, 4096));
      const result = await auth[route.endsWith('login') ? 'login' : 'accept'](input, clientAddress(req, config));
      res.setHeader('Set-Cookie', sessionCookie(result.token, origin.startsWith('https:')));
      return json(res, { user: result.user, projectVersion: CURRENT_PROJECT_VERSION });
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
    const workspaceFont = route.match(/^\/fonts\/workspace\/([a-f0-9-]{36})\.(woff2|woff|otf|ttf)$/);
    const workerRead = req.method === 'GET' && (privateAsset || workspaceFont || /^\/api\/exports\/[a-f0-9-]{36}$/.test(route));
    const renderer = !user && workerRead && (await personalRenderers.engine(req.headers.authorization) || renderWorker.authorize(req.headers.authorization));
    if ((route.startsWith('/api/') || privateAsset || route.startsWith('/fonts/workspace/') || route.startsWith('/exports/')) && !user && !renderer) return json(res, { error: 'Sign in to continue.' }, 401);
    if (user && !['GET', 'HEAD'].includes(req.method) && req.headers.origin !== origin) return json(res, { error: 'A same-origin request is required.' }, 403);
    // Team, invitations, storage cleanup, activity and the font library's changes are admin-only; the UI hides them, the server decides.
    const adminRoute = ['/api/auth/invitations', '/api/users', '/api/audit', '/api/storage/cleanup'].includes(route) || route.startsWith('/api/users/') || (route === '/api/fonts' && req.method !== 'GET') || route.startsWith('/api/fonts/');
    if (adminRoute && user?.role !== 'admin') return json(res, { error: 'Only admins can do this.' }, 403);
    if (route === '/api/auth/invitations' && req.method === 'POST') {
      const invitation = await auth.invite(JSON.parse(await body(req, 4096)), user.id);
      return json(res, { email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt, url: `${origin}/#invite=${invitation.token}` }, 201);
    }
    if (route === '/api/users' && req.method === 'GET') return json(res, { users: await auth.users() });
    const userMatch = route.match(/^\/api\/users\/([a-f0-9-]{36})$/);
    if (userMatch && req.method === 'PATCH') return json(res, { user: await auth.setRole(userMatch[1], JSON.parse(await body(req, 4096)).role, user.id) });
    if (userMatch && req.method === 'DELETE') { await auth.remove(userMatch[1], user.id); return json(res, { deleted: true }); }
    if (route === '/api/audit' && req.method === 'GET') return json(res, audit.page({ before: url.searchParams.get('before') ?? undefined, limit: url.searchParams.get('limit') ?? undefined }));
    if (route === '/api/renderers/status' && req.method === 'GET') return json(res, { required: Boolean(config.publicOrigin), ...await personalRenderers.status(await personalRenderers.browser(req.headers.cookie)) });
    if (route === '/api/renderers/pair' && req.method === 'POST') {
      const pairing = await personalRenderers.startPairing(req.headers.cookie, user.id);
      res.setHeader('Set-Cookie', rendererCookie(pairing.key, origin.startsWith('https:')));
      return json(res, { code: pairing.code, expiresAt: pairing.expiresAt }, 201);
    }
    const draftMatch = route.match(/^\/api\/drafts\/([a-f0-9-]{36})$/);
    if (draftMatch && req.method === 'GET') return json(res, await drafts.read(draftMatch[1]));
    if (draftMatch && req.method === 'PUT') return json(res, await drafts.update(draftMatch[1], JSON.parse(await body(req))));
    const draftArchiveMatch = route.match(/^\/api\/drafts\/([a-f0-9-]{36})\/archive$/);
    if (draftArchiveMatch && req.method === 'POST') return json(res, { composition: await templates.archiveDraft(draftArchiveMatch[1], { userId: user?.id }) });
    if (route === '/api/templates' && req.method === 'GET') return json(res, { templates: await templates.list() });
    if (route === '/api/templates' && req.method === 'POST') return json(res, await templates.create(JSON.parse(await body(req)), { userId: user?.id }), 201);
    const templateMatch = route.match(/^\/api\/templates\/([a-f0-9-]{36})$/);
    if (templateMatch && req.method === 'GET') return json(res, await templates.read(templateMatch[1]));
    if (templateMatch && req.method === 'PUT') return json(res, await templates.update(templateMatch[1], JSON.parse(await body(req)), { userId: user?.id }));
    if (templateMatch && req.method === 'DELETE') { await templates.remove(templateMatch[1], { userId: user?.id }); return json(res, { deleted: true }); }
    const versionMatch = route.match(/^\/api\/templates\/([a-f0-9-]{36})\/versions(?:\/(\d{1,9})(\/restore)?)?$/);
    if (versionMatch && !versionMatch[2] && req.method === 'GET') return json(res, { versions: await templates.versions(versionMatch[1]) });
    if (versionMatch?.[2] && !versionMatch[3] && req.method === 'GET') return json(res, await templates.version(versionMatch[1], versionMatch[2]));
    if (versionMatch?.[3] && req.method === 'POST') return json(res, await templates.restore(versionMatch[1], versionMatch[2], JSON.parse(await body(req, 4096)), { userId: user?.id }));
    if (route === '/api/storage' && req.method === 'GET') return json(res, await storage.usage());
    if (route === '/api/storage/cleanup' && req.method === 'POST') {
      const input = JSON.parse(await body(req, 4096)), result = await storage.cleanup({ dryRun: input.confirm !== true });
      if (!result.dryRun) audit.record({ actorId: user.id, action: 'storage.cleanup', details: { removedFiles: result.removedFiles, removedBytes: result.removedBytes } });
      return json(res, result);
    }
    if (route === '/api/catalog') return json(res, { templates: TEMPLATES, effects: EFFECTS, catalog: catalogSummary(), rawCatalog: '/catalog/presets.json' });
    if (route === '/api/assets' && req.method === 'GET') return json(res, { assets: await storage.library() });
    if (route === '/api/assets' && req.method === 'POST') {
      const name = url.searchParams.get('name') || ''; const ext = path.extname(name).toLowerCase().slice(1);
      if (!Object.hasOwn(types, ext) || ['html', 'css', 'js', 'woff2'].includes(ext)) return json(res, { error: 'Unsupported upload type.' }, 400);
      const fileName = path.basename(name).slice(0, 200);
      const asset = await storage.upload(req, { ext, name: fileName, run, convertGif: ensureGifVideo });
      return json(res, { id: asset.id, src: `/assets/${asset.id}.${ext}`, name: fileName, type: types[ext] });
    }
    if (route === '/api/fonts' && req.method === 'GET') return json(res, { fonts: fonts.list() });
    if (route === '/api/fonts' && req.method === 'POST') {
      const font = await fonts.upload(req, { name: url.searchParams.get('name') || '', family: url.searchParams.get('family'), weight: url.searchParams.get('weight'), style: url.searchParams.get('style'), userId: user.id });
      audit.record({ actorId: user.id, action: 'font.uploaded', target: { type: 'font', id: font.id }, details: { family: font.family, weight: font.weight, style: font.style, fileName: font.fileName } });
      return json(res, { font }, 201);
    }
    const fontMatch = route.match(/^\/api\/fonts\/([a-f0-9-]{36})$/);
    if (fontMatch && req.method === 'PATCH') {
      const { previous, font } = fonts.update(fontMatch[1], JSON.parse(await body(req, 4096)));
      const face = item => ({ family: item.family, weight: item.weight, style: item.style });
      audit.record({ actorId: user.id, action: 'font.renamed', target: { type: 'font', id: font.id }, details: { from: face(previous), to: face(font) } });
      return json(res, { font });
    }
    if (fontMatch && req.method === 'DELETE') {
      const removed = await fonts.remove(fontMatch[1]);
      audit.record({ actorId: user.id, action: 'font.deleted', target: { type: 'font', id: removed.id }, details: { family: removed.family, weight: removed.weight, style: removed.style } });
      return json(res, { deleted: true });
    }
    if (route === '/api/exports' && req.method === 'GET') return json(res, { jobs: await listJobs(data, jobs, (await personalRenderers.browser(req.headers.cookie))?.id) });
    if (route === '/api/exports' && req.method === 'POST') {
      const input = JSON.parse(await body(req));
      const device = await personalRenderers.browser(req.headers.cookie);
      const queued = job => { audit.exportQueued(user.id, job); return json(res, job, 202); };
      // Workspace font faces travel with the job so renderers can fetch them without the library.
      const faces = fonts.facesFor(input.project);
      if (device) return queued(await personalRenderers.enqueue(device, input.project, input.settings, faces));
      if (config.publicOrigin) return json(res, { error: 'Connect this computer’s renderer in Export before rendering.' }, 503);
      return queued(await (renderWorker.enabled ? renderWorker.enqueue(input.project, input.settings, faces) : startExport(input.project, input.settings, faces)));
    }
    const cancelMatch = route.match(/^\/api\/exports\/([a-f0-9-]{36})\/cancel$/);
    if (cancelMatch && req.method === 'POST') {
      const device = await personalRenderers.browser(req.headers.cookie);
      const job = await personalRenderers.job(device, cancelMatch[1]);
      if (!job) return json(res, { error: 'Export not found.' }, 404);
      if (isTerminalJobState(job.state)) return json(res, { error: 'This export already ended and cannot be cancelled.' }, 409);
      const cancelled = job.rendererId ? await personalRenderers.cancel(device, job.id) : await renderWorker.cancel(job.id) || await cancelExport(job.id);
      audit.exportCancelled(user.id, cancelled);
      return json(res, cancelled);
    }
    const jobMatch = route.match(/^\/api\/exports\/([a-f0-9-]{36})$/);
    if (jobMatch) {
      const device = await personalRenderers.browser(req.headers.cookie) || await personalRenderers.engine(req.headers.authorization);
      let job = await personalRenderers.job(device, jobMatch[1]);
      if (!job?.rendererId) job = await renderWorker.status(jobMatch[1]) || job;
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
    if (workspaceFont) {
      const face = fonts.find(workspaceFont[1]);
      if (!face || face.ext !== workspaceFont[2]) return json(res, { error: 'Font not found.' }, 404);
      return await file(req, res, fonts.path(face), FONT_FILE_TYPES[face.ext].mime);
    }
    const exportMatch = route.match(/^\/exports\/([a-f0-9-]{36})\/(video\.mp4|video\.mov|frames\.zip)$/);
    if (exportMatch) {
      const device = await personalRenderers.browser(req.headers.cookie);
      await personalRenderers.job(device, exportMatch[1]);
      return await file(req, res, path.join(data, 'renders', exportMatch[1], exportMatch[2]), EXPORT_FORMATS.find(item => item.file === exportMatch[2]).mime);
    }
    // Vite's production bundles share /assets/ with uploaded media.
    if (!vite && route.startsWith('/assets/')) {
      const directory = path.join(root, 'dist', 'assets');
      const filename = path.resolve(directory, decodeURIComponent(route.slice('/assets/'.length)));
      if (!filename.startsWith(directory + path.sep)) return json(res, { error: 'Not found.' }, 404);
      return await file(req, res, filename);
    }
    if (route.startsWith('/api/') || route.startsWith('/assets/') || route.startsWith('/exports/') || route.startsWith('/fonts/workspace/')) return json(res, { error: 'Not found.' }, 404);
    if (vite) return vite.middlewares(req, res);
    const safe = decodeURIComponent(route).replace(/^\/+/, '');
    const filename = path.resolve(root, 'dist', safe || 'index.html');
    if (!filename.startsWith(path.join(root, 'dist') + path.sep)) return json(res, { error: 'Not found.' }, 404);
    try { await file(req, res, filename); } catch { await file(req, res, path.join(root, 'dist/index.html')); }
  } catch (error) { if (!res.headersSent) json(res, { error: error.code === 'ENOENT' ? 'File not found.' : error.message }, error.status || (error.code === 'ENOENT' ? 404 : 400)); else res.destroy(); }
}));
server.listen(port, config.host, () => console.log(`FLOC Motion: ${config.publicOrigin || `http://127.0.0.1:${port}`}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); vite?.close(); process.exit(0); });
