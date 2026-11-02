import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { fontFaceCss } from '../src/fonts.js';
import { elementMotionFixture } from './fixtures/element-motion-fixture.js';
import { executablePath, openGoldenSession, PARITY_TOLERANCE } from '../scripts/golden-frames.mjs';

const types = ['text', 'logo', 'media', 'carousel', 'model', 'dataflow'];
const close = (actual, expected, label, tolerance = .025) => assert.ok(Math.abs(actual - expected) < tolerance, `${label}: ${actual} != ${expected}`);

test('whole-element transforms preserve layout, move picking and bounds, and reset on arbitrary seeks in Flat and Spatial', { skip: !executablePath && 'Chrome is required', timeout: 180000 }, async t => {
  const bundle = await build({ stdin: { resolveDir: path.resolve('src'), contents: `
    import {createScene,stageMarkup} from './scene.js';
    import {normalizeElementMotion} from './element-motion.js';
    import {FORMATS} from './project.js';
    window.exercise = async projects => {
      const results=[];
      for(const initial of projects){
        const [w,h]=FORMATS[initial.format],root=document.querySelector('.stage');root.style.width=w+'px';root.style.height=h+'px';root.innerHTML=stageMarkup(initial);
        await document.fonts.ready;
        const errors=[],scene=await createScene(root,initial,{renderMode:true,onMediaError:e=>errors.push(e.message)});scene.setResolution(360,Math.round(360*h/w));
        const subject=root.querySelector('[data-floc-layer="subject"]'),style=getComputedStyle(subject),cx=(parseFloat(style.left)+parseFloat(style.width)/2)/w*100,cy=(parseFloat(style.top)+parseFloat(style.height)/2)/h*100;
        const layout=()=>({width:subject.offsetWidth,height:subject.offsetHeight,font:subject.style.fontSize});
        const pixels=()=>{const c=root.querySelector('[data-floc-scene-output]');return c.getContext('2d').getImageData(0,0,c.width,c.height).data;};
        const difference=(a,b)=>{let changed=0;for(let i=0;i<a.length;i+=4)if(Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]))>16)changed++;return changed/(a.length/4);};
        const render=async motion=>{const p={...initial,layers:initial.layers.map(l=>l.id==='subject'?{...l,elementMotion:normalizeElementMotion(motion)}:l)};if(!await scene.update(p))throw Error('movement edit rebuilt the scene');await scene.seek(0,false);return scene.projectedBounds('subject');};
        try{
          await scene.seek(0,false);const base=scene.projectedBounds('subject'),baseline=pixels(),baseLayout=layout();
          let hit;
          for(let y=1;y<16&&!hit;y++)for(let x=1;x<24&&!hit;x++){const u=(base.x+base.width*x/24)/100,v=(base.y+base.height*y/16)/100;if(scene.pick(u,v)==='subject')hit={u,v};}
          const moved=await render({float:{enabled:true,axis:'x',amplitude:4,phase:.25,direction:0}}),movedPixels=pixels();
          const movedHit=hit?scene.pick(hit.u+4*Math.min(w,h)/w/100,hit.v):null;
          const pulsed=await render({pulse:{enabled:true,amplitude:.2,phase:.25,direction:0}});
          const pulseLayout=layout();
          const spun=await render({spin:{enabled:true,phase:.25,direction:0}});
          await render({float:{enabled:true,amplitude:3,duration:4}});
          await scene.seek(1,false);const forward=scene.projectedBounds('subject');await scene.seek(3,false);const backward=scene.projectedBounds('subject');
          await render({float:{enabled:true,amplitude:3,duration:4},spin:{enabled:true,duration:8},pulse:{enabled:true,amplitude:.2,duration:4}});
          await scene.seek(.5,false);const a=pixels(),combinedBounds=scene.projectedBounds('subject');await scene.seek(1.7,false);const animatedDifference=difference(a,pixels());await scene.seek(.5,false);const seekDifference=difference(a,pixels());
          await render({});const restored=scene.projectedBounds('subject'),resetDifference=difference(baseline,pixels());
          results.push({type:initial.layers[1].type,space:initial.layers[1].space,format:initial.format,base,moved,pulsed,spun,restored,forward,backward,cx,cy,hit:!!hit,movedHit,baseLayout,pulseLayout,combinedBounds,animatedDifference,seekDifference,resetDifference,motionDifference:difference(baseline,movedPixels),errors});
        }finally{scene.dispose();root.replaceChildren();}
      }return results;
    };
  ` }, bundle: true, write: false, format: 'iife' });
  const mime = { '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(bundle.outputFiles[0].text); }
    if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); return res.end(`<html><head><style>${fontFaceCss('/fonts/')}*{box-sizing:border-box}body{margin:0}.stage{position:relative;overflow:hidden;font-family:Geist,Arial,sans-serif}</style></head><body><div class="stage"></div><script src="/bundle.js"></script></body></html>`); }
    try { if (!/^\/(fonts|brand|demo|shapes)\/[a-zA-Z0-9_./-]+$/.test(url.pathname) || url.pathname.includes('..')) throw Error('not found'); const bytes = await readFile(path.resolve('public', '.' + url.pathname)); res.setHeader('Content-Type', mime[path.extname(url.pathname)] ?? 'application/octet-stream'); res.end(bytes); } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-color-profile=srgb'] });
  t.after(() => browser.close());
  const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const projects = ['flat', 'spatial'].flatMap(space => types.map(type => elementMotionFixture(type, space, { format: 'landscape' })));
  const rows = await page.evaluate(projects => window.exercise(projects), projects);
  assert.deepEqual(errors, []);
  for (const row of rows) {
    const label = `${row.space} ${row.type}`; assert.deepEqual(row.errors, [], label);
    assert.ok(row.hit, `${label} has pickable geometry`); assert.equal(row.movedHit, 'subject', `${label} picking follows float`);
    close(row.moved.x - row.base.x, 2.25, `${label} float distance`); close(row.moved.y, row.base.y, `${label} float axis`);
    close(row.moved.width, row.base.width, `${label} float preserves width`);
    close(row.forward.y - row.base.y, 3, `${label} clock reaches the positive float peak`);
    close(row.backward.y - row.base.y, -3, `${label} clock reaches the negative float peak`);
    // Pulse captures at a new density; its padded raster bounds round to pixels.
    close(row.pulsed.width, row.base.width * 1.2, `${label} pulse width`, 100 / 360);
    close(row.pulsed.height, row.base.height * 1.2, `${label} pulse height`, 100 / (360 * 1080 / 1920));
    close(row.spun.width, row.base.height * 1080 / 1920, `${label} spin width`); close(row.spun.height, row.base.width * 1920 / 1080, `${label} spin height`);
    assert.deepEqual(row.pulseLayout, row.baseLayout, `${label} pulse does not reflow or reframe source`);
    close(row.restored.x, row.base.x, `${label} restore x`); close(row.restored.width, row.base.width, `${label} restore width`);
    assert.ok(row.motionDifference > .0001, `${label} float changes actual pixels`);
    assert.ok(row.animatedDifference > .0001, `${label} combined movement advances with time`);
    assert.ok(row.seekDifference <= .002, `${label} seek: ${row.seekDifference}`); assert.ok(row.resetDifference <= .002, `${label} reset: ${row.resetDifference}`);
  }
});

test('combined element and internal movement agree in preview and real prepared export, including refractive 3D', { skip: !executablePath && 'Chrome is required', timeout: 180000 }, async t => {
  const session = await openGoldenSession({ lanes: 1 }); t.after(() => session.close());
  const fixtures = ['flat', 'spatial'].flatMap(space => ['text', 'carousel', 'model'].map(type => {
    const project = elementMotionFixture(type, space, { animated: true, glass: type === 'model' });
    project.layers[1].elementMotion = { float: { enabled: true, axis: 'x', amplitude: 5, duration: 4, phase: .1, direction: -1 }, spin: { enabled: true, duration: 8, phase: .05, direction: 1 }, pulse: { enabled: true, amplitude: .15, duration: 4, phase: 0, direction: 1 } };
    return { id: `element-${space}-${type}`, project, times: [.5, 1.7] };
  }));
  const frames = await session.captureAll(fixtures);
  for (const [id, samples] of Object.entries(frames)) for (const sample of samples) {
    const comparison = await session.compare(sample.preview, sample.exported, PARITY_TOLERANCE);
    assert.ok(comparison.ok, `${id} ${sample.time}: ${comparison.summary}`);
  }
});
