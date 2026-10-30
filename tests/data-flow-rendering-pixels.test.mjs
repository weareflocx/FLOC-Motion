import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { browserCandidates } from '../scripts/renderer-runtime.mjs';

const executablePath = [process.env.HYPERFRAMES_BROWSER_PATH, ...browserCandidates()].find(file => file && existsSync(file));

test('Data flow renders deterministic transparent Flat/Spatial sources with effective geometry controls and shared depth', { skip: !executablePath && 'Chrome or Edge is required for flow rendering', timeout: 120000 }, async t => {
  const bundle = await build({ stdin: { resolveDir: path.resolve('src'), contents: `
    import * as THREE from 'three';
    import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
    import { createScene, stageMarkup } from './scene.js';
    import { blankProject, fileLayer, validateProject } from './project.js';
    import { dataFlowLayer } from './data-flow-style.js';
    import { DEFAULT_MODEL_STYLE } from './model-style.js';
    const root=document.getElementById('stage'), errors=[];
    let engine, project;
    let contexts=0;const getContext=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(kind,...args){if(kind==='webgl2')contexts++;return getContext.call(this,kind,...args);};
    const side=360;
    function flow(space='flat') { const layer=dataFlowLayer(12,'flow');layer.space=space;return layer; }
    function base(layer=flow()) { const p=blankProject('Flow renderer');p.layers=[layer];return p; }
    const pixels=()=>{const c=root.querySelector('[data-floc-scene-output]');return c.getContext('2d').getImageData(0,0,c.width,c.height).data;};
    const difference=(a,b)=>{let n=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])n++;return n;};
    function stats(data) {let covered=0,transparent=0,alpha=0,first=null;for(let i=0;i<data.length;i+=4){alpha+=data[i+3];if(data[i+3]===0)transparent++;if(data[i+3]>32){covered++;first??={x:(i/4)%side,y:Math.floor(i/4/side)};}}return{covered,transparent,alpha,first};}
    async function mount(value) {engine?.dispose();project=validateProject(value);root.innerHTML=stageMarkup(project);engine=await createScene(root,project,{renderMode:true,onMediaError:e=>errors.push(e.message)});engine.setResolution(side,side);await engine.seek(.7);return pixels();}
    async function patch(value) {project=validateProject({...project,layers:project.layers.map(layer=>layer.id==='flow'?{...layer,...value}:layer)});if(!engine.update(project))throw new Error('A flow setting unexpectedly rebuilt its scene');await engine.seek(.7);return pixels();}
    async function style(value) {return patch({flowStyle:{...project.layers.find(layer=>layer.id==='flow').flowStyle,...value}});}
    window.exerciseDataFlow=async()=>{
      const result={};let image=await mount(base());result.flat=stats(image);
      result.contexts=contexts;
      const sourcePixels=()=>{const c=root.querySelector('#dataflow-flow');return c.getContext('2d').getImageData(0,0,c.width,c.height).data;};
      const initialSource=sourcePixels();await engine.seek(.7);result.repeatDifference=difference(image,pixels());result.repeatSourceDifference=difference(initialSource,sourcePixels());
      engine.setResolution(720,720);await engine.seek(.7);result.doubleResolution=stats(pixels());
      engine.setResolution(side,side);await engine.seek(.7);
      result.resizeDifference=difference(image,pixels());result.resizeSourceDifference=difference(initialSource,sourcePixels());
      await engine.seek(4.2);await engine.seek(.7);result.seekDifference=difference(image,pixels());
      const at=.7;await engine.seek(2);result.timeDifference=difference(image,pixels());await engine.seek(at);
      const rolled=await patch({roll:37});result.flatRollDifference=difference(image,rolled);
      result.flatRollRestored=difference(image,await patch({roll:0}));
      engine.setPlacement({id:'flow',roll:37});await engine.seek(.7);
      result.flatDraftRollDifference=difference(rolled,pixels());result.flatDraftRollVisible=difference(image,pixels());
      engine.setPlacement(null);await engine.seek(.7);result.flatDraftRollRestored=difference(image,pixels());
      result.seedDifference=difference(image,await style({seed:41}));
      image=await style({seed:7,particleCount:0,glowStrength:0});result.thin=stats(image);
      result.wide=stats(await style({lineWidth:6}));
      result.fewer=stats(await style({fiberCount:12}));
      image=await style({lineOpacity:0,particleCount:1500,particleSize:2});result.smallPulses=stats(image);
      result.largePulses=stats(await style({particleSize:10}));
      result.morePulses=stats(await style({particleCount:5000}));
      image=await style({glowStrength:0,particleCount:1500,particleSize:2});result.noGlow=stats(image);
      result.glow=stats(await style({glowStrength:3,glowRadius:1}));
      result.zero=stats(await style({particleCount:0}));
      image=await mount(base());result.colorDifference=difference(image,await style({lineColor:'#ff0000',particleColor:'#00ff00'}));
      image=pixels();result.faded=stats(await patch({opacity:.25}));result.unfaded=stats(image);
      image=await mount(base());const point=stats(image).first;
      result.flatPick=point?engine.pick((point.x+.5)/side,(point.y+.5)/side):null;
      result.emptyPick=engine.pick(.001,.001);result.flatBounds=engine.projectedBounds('flow');
      result.flatEffectsDifference=difference(image,await patch({effects:[{type:'monochrome',amount:1}]}));
      image=await mount(base(flow('spatial')));result.spatial=stats(image);result.spatialBounds=engine.projectedBounds('flow');result.depth=engine.depthInfo();
      const visible=stats(image).first;result.spatialPick=visible?engine.pick((visible.x+.5)/side,(visible.y+.5)/side):null;
      await engine.seek(0);result.spatialStart=stats(pixels());
      await engine.seek(7);await engine.seek(.7);result.spatialSeekDifference=difference(image,pixels());
      result.poseDifference=difference(image,await patch({yaw:35,tilt:20,z:10}));
      image=await mount(base(flow('spatial')));result.spatialEffectsDifference=difference(image,await patch({effects:[{type:'monochrome',amount:1}]}));
      // The opaque cube is earlier in the stack. Its actual front surface must
      // still occlude every later fiber, pulse and soft halo behind that surface.
      const mesh=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial({color:'#ff0000'}));
      const bytes=await new GLTFExporter().parseAsync(mesh,{binary:true});mesh.geometry.dispose();mesh.material.dispose();
      const src=URL.createObjectURL(new Blob([bytes],{type:'model/gltf-binary'}));
      const asset='/assets/00000000-0000-4000-8000-000000000001.glb';
      const p=base(flow('spatial'));p.layers.unshift({...fileLayer({name:'Opaque red cube',src:asset},12,'cube'),space:'spatial',x:0,y:0,size:100,z:60,modelStyle:{...DEFAULT_MODEL_STYLE,base:'imported',environment:'none',toneMapping:'none',motion:'none',animationClip:-1}});
      engine.dispose();project=validateProject(p);const transported={...project,layers:project.layers.map(layer=>layer.id==='cube'?{...layer,src}:layer)};
      root.innerHTML=stageMarkup(transported);engine=await createScene(root,transported,{renderMode:true});engine.setResolution(side,side);await engine.seek(.7);
      image=pixels();let occlusionErrors=0,occluded=0;
      for(let y=140;y<220;y++)for(let x=140;x<220;x++){const i=(y*side+x)*4;occluded++;if(image[i]<250||image[i+1]>5||image[i+2]>5||image[i+3]!==255)occlusionErrors++;}
      result.occlusionErrors=occlusionErrors;result.occluded=occluded;result.opaquePick=engine.pick(.5,.5);
      engine.dispose();URL.revokeObjectURL(src);result.errors=errors;return result;
    };
  ` }, bundle: true, write: false, format: 'iife' });
  const angle = process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d11' : 'gl-egl';
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', `--use-angle=${angle}`, '--force-color-profile=srgb'] });
  t.after(() => browser.close());
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setRequestInterception(true);
  page.on('request', request => /^https?:/.test(request.url()) ? (errors.push('Unexpected external request'), request.abort()) : request.continue());
  await page.setContent('<style>body{margin:0}#stage{position:relative;width:1080px;height:1080px;overflow:hidden}canvas{display:block}</style><div id="stage"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(() => window.exerciseDataFlow());
  assert.equal(result.contexts, 1, 'all flow sources use the single composition WebGL2 context');
  assert.ok(Math.abs(result.doubleResolution.alpha / result.flat.alpha / 4 - 1) < .3, 'line and pulse coverage scales with export resolution');
  assert.deepEqual(errors, []);
  assert.deepEqual(result.errors, []);
  assert.ok(result.flat.covered > 100, JSON.stringify(result.flat));
  assert.ok(result.flat.transparent > 1000, 'transparent export retains empty pixels, not a black rectangle');
  for (const key of ['repeatDifference', 'repeatSourceDifference', 'resizeDifference', 'resizeSourceDifference']) assert.equal(result[key], 0, key);
  assert.ok(result.spatialStart.covered > 100, 'default Spatial flow is visibly usable from its first frame');
  assert.equal(result.seekDifference, 0);
  assert.equal(result.spatialSeekDifference, 0);
  assert.ok(result.flatRollDifference > 100, 'saved Flat Z orientation changes the actual rendered fibers');
  assert.ok(result.flatDraftRollVisible > 100, 'live Flat Z orientation changes the actual rendered fibers');
  for (const key of ['flatRollRestored', 'flatDraftRollDifference', 'flatDraftRollRestored']) assert.equal(result[key], 0, key);
  for (const key of ['seedDifference', 'timeDifference', 'colorDifference', 'poseDifference', 'flatEffectsDifference', 'spatialEffectsDifference']) assert.ok(result[key] > 100, key);
  assert.ok(result.wide.alpha > result.thin.alpha * 1.5, 'line width changes actual ribbon coverage');
  assert.ok(result.fewer.alpha < result.wide.alpha * .8, 'fiber count changes geometry');
  assert.ok(result.largePulses.alpha > result.smallPulses.alpha * 2, 'pulse size changes actual quads');
  assert.ok(result.morePulses.alpha > result.largePulses.alpha, 'pulse count changes visible emission');
  assert.ok(result.glow.alpha > result.noGlow.alpha * 1.2, 'local Gaussian halos have visible radius and strength');
  assert.equal(result.zero.covered, 0, 'zero particles and hidden fibers leave a fully transparent frame');
  assert.ok(result.faded.alpha < result.unfaded.alpha * .4, 'layer opacity applies to the whole transparent leaf');
  assert.equal(result.flatPick, 'flow');
  assert.equal(result.spatialPick, 'flow');
  assert.equal(result.emptyPick, null, 'empty canvas margins are not pickable');
  assert.ok(result.flatBounds?.width > 0 && result.spatialBounds?.width > 0);
  assert.ok(result.spatial.covered > 100);
  assert.ok(result.depth.some(layer => layer.id === 'flow' && layer.max > layer.min));
  assert.equal(result.occlusionErrors, 0, `${result.occlusionErrors}/${result.occluded} cube pixels were overwritten by transparent geometry`);
  assert.equal(result.opaquePick, 'cube');
});
