import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { executablePath } from '../scripts/golden-frames.mjs';

test('mosaic assembles whole images, holds, wraps, seeks and updates its visible controls', { skip: !executablePath && 'Chrome or Edge is required', timeout: 120000 }, async t => {
  const bundle = await build({ stdin: { resolveDir: path.resolve('src'), contents: `
    import { createScene, stageMarkup } from './scene.js';
    import { demoProject, patchLayer, validateProject } from './project.js';
    const root=document.querySelector('#stage'), side=240;
    let project,engine;
    const pixels=()=>{const c=root.querySelector('[data-floc-scene-output]');return c.getContext('2d').getImageData(0,0,c.width,c.height).data;};
    const diff=(a,b)=>{let n=0;for(let i=0;i<a.length;i+=4)if(Math.max(...[0,1,2,3].map(k=>Math.abs(a[i+k]-b[i+k])))>8)n++;return n/(a.length/4);};
    async function mount(images) {
      engine?.dispose();
      project=patchLayer(demoProject(),'carousel',{template:'kinetic-mosaic'});
      project=validateProject({...project,images:images??project.images.slice(0,3),layers:project.layers.filter(l=>l.type==='carousel')});
      root.innerHTML=stageMarkup(project);
      engine=await createScene(root,project,{renderMode:true});engine.setResolution(side,side);
    }
    async function seek(time){await engine.seek(time,false);return pixels();}
    async function patch(values,time=.4){project=patchLayer(project,'carousel',values);if(!engine.update(project))throw new Error('Mosaic edits must update in place');return seek(time);}
    window.exercise=async()=>{
      const result={};await mount();const images=project.images;
      const start=await seek(0),transition=await seek(.4),settled=await seek(.8);
      result.transition=diff(start,transition);
      result.hold=diff(settled,await seek(1.4));result.handoff=diff(settled,await seek(2.8));
      result.seek=diff(transition,await seek(.4));result.loop=diff(start,await seek(8.4));
      result.controls={};
      for(const [field,value,original] of [['mosaicColumns',2,5],['mosaicRows',2,5],['mosaicZoom',0,.8],['mosaicStagger',0,.35],...['inward','left','right','up','down'].map(v=>['motionVariant',v,'outward'])]){
        result.controls[field+value]=diff(transition,await patch({[field]:value}));await patch({[field]:original});
      }
      const faded=await patch({opacity:.4});result.opacity=diff(transition,faded);
      result.transparent=[...faded].filter((v,i)=>i%4===3&&v===0).length;
      await mount([images[1]]);result.whole=diff(settled,await seek(0));result.single=diff(await seek(.4),await seek(1.7));
      const transparent={id:'alpha',name:'Transparent image',src:'/assets/00000000-0000-4000-8000-000000000001.svg'};
      await mount([images[0],transparent]);const alphaEnd=await seek(.8),alphaBefore=await seek(.8-1e-8);
      result.alphaHandoff=diff(alphaEnd,alphaBefore);
      await mount([transparent]);const alphaStill=await seek(0);result.alphaWhole=diff(alphaEnd,alphaStill);
      result.semitransparent=[...alphaStill].filter((v,i)=>i%4===3&&v>0&&v<255).length;
      await mount([]);result.emptyAlpha=[...await seek(.4)].filter((v,i)=>i%4===3).reduce((a,b)=>a+b,0);
      engine.dispose();return result;
    };
  ` }, bundle: true, write: false, format: 'iife' });
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-compositing'] });
  t.after(() => browser.close());
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setRequestInterception(true);
  page.on('request', async request => {
    const url = new URL(request.url());
    if (url.origin === 'http://mosaic.test' && /^\/demo\/poster-\d\.svg$/.test(url.pathname)) {
      await request.respond({ status: 200, contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' }, body: await readFile(path.join('public', url.pathname)) });
    } else if (url.pathname === '/assets/00000000-0000-4000-8000-000000000001.svg') {
      await request.respond({ status: 200, contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' }, body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="200" height="300" fill="#00ccff" opacity=".5"/></svg>' });
    } else { errors.push(`Unexpected resource: ${request.url()}`); await request.abort(); }
  });
  await page.setContent('<base href="http://mosaic.test"><style>body{margin:0}#stage{position:relative;width:1080px;height:1080px;overflow:hidden}</style><div id="stage"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(() => window.exercise()).catch(error => { throw new Error(`${error.message}: ${errors.join('; ')}`, { cause: error }); });
  assert.deepEqual(errors, []);
  for (const key of ['hold','handoff','seek','loop','whole','single','emptyAlpha','alphaHandoff','alphaWhole']) assert.equal(result[key], 0, key);
  assert.ok(result.transition > .01, 'tiles visibly animate between photographs');
  for (const [key, difference] of Object.entries(result.controls)) assert.ok(difference > .01, `${key}: ${difference}`);
  assert.ok(result.opacity > .01, 'opacity affects the assembled source');
  assert.ok(result.transparent > 1000, 'margins remain transparent');
  assert.ok(result.semitransparent > 1000, 'transparent photographs retain partial alpha after the handoff');
});
