import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { browserCandidates } from '../scripts/renderer-runtime.mjs';

const executablePath = [process.env.HYPERFRAMES_BROWSER_PATH, ...browserCandidates()].find(file => file && existsSync(file));

test('one shared scene depth-tests photos, editable text and actual model geometry independently of layer order', { skip: !executablePath && 'Chrome or Edge is required for shared-depth verification', timeout: 120000 }, async t => {
  const bundle = await build({ stdin: { resolveDir: path.resolve('src'), contents: `
    import * as THREE from 'three';
    import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
    import { createScene, stageMarkup } from './scene.js';
    import { blankProject, demoProject, fileLayer, patchLayer, validateProject } from './project.js';
    import { DEFAULT_MODEL_STYLE } from './model-style.js';
    const paths = { model:'/assets/00000000-0000-4000-8000-000000000001.glb', blue:'/assets/00000000-0000-4000-8000-000000000002.svg', green:'/assets/00000000-0000-4000-8000-000000000003.svg', yellow:'/assets/00000000-0000-4000-8000-000000000004.svg' };
    const local = new Map(), urls = [], errors = [];
    let engine, project;
    const root = document.getElementById('stage');
    async function assets() {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshBasicMaterial({color:'#ff0000'}));
      const model = await new GLTFExporter().parseAsync(mesh,{binary:true});
      mesh.geometry.dispose(); mesh.material.dispose();
      const url = URL.createObjectURL(new Blob([model],{type:'model/gltf-binary'})); urls.push(url); local.set(paths.model,url);
      for(const [name,color] of [['blue','#0000ff'],['green','#00ff00'],['yellow','#ffff00']]) local.set(paths[name], 'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="'+color+'"/></svg>'));
    }
    const item = value => ({...value,src:local.get(value.src)??value.src});
    const transport = value => ({...value,images:value.images.map(item),layers:value.layers.map(layer=>({...item(layer),...(layer.images?{images:layer.images.map(item)}:{})}))});
    async function mount(value) {
      engine?.dispose(); project=validateProject(value); root.innerHTML=stageMarkup(transport(project));
      engine=await createScene(root,transport(project),{onMediaError:error=>errors.push(error.message)});
      engine.setResolution(360,360); await engine.seek(.7); return pixels();
    }
    const pixels=()=>{const c=root.querySelector('[data-floc-scene-output]');return c.getContext('2d').getImageData(0,0,c.width,c.height).data;};
    async function patch(id, value) { project=patchLayer(project,id,value); if(!engine.update(transport(project)))throw new Error('A depth edit unexpectedly rebuilt the scene'); await engine.seek(.7); return pixels(); }
    const center=value=>[...value.slice((180*360+180)*4,(180*360+180)*4+4)];
    const difference=(a,b)=>{let count=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])count++;return count;};
    function modelProject() {
      const p=blankProject('Shared cube');
      p.layers.push({...fileLayer({name:'Red cube',src:paths.model},12,'cube'),x:20,y:20,size:60,modelStyle:{...DEFAULT_MODEL_STYLE,base:'imported',environment:'none',toneMapping:'none',motion:'none',animationClip:-1}});
      p.layers.push({...fileLayer({name:'Blue plane',src:paths.blue},12,'plane'),x:20,y:20,size:60});
      return validateProject(p);
    }
    function wheelProject() {
      const p=blankProject('Wheel with central type');
      p.images=[{id:'green',name:'Green',src:paths.green},{id:'yellow',name:'Yellow',src:paths.yellow}];
      p.layers.push({...demoProject().layers.find(layer=>layer.type==='carousel'),id:'wheel',template:'wheel',x:50,y:50,size:2.5,radius:1,cardAspect:1,cardCount:4,speed:0,tilt:45,yaw:0,roll:0,curve:0,fadeIn:0,fadeOut:0});
      p.layers.push({id:'title',type:'text',name:'Center text',visible:true,locked:false,start:0,end:12,text:'OOO\\nOOO',font:'geist',weight:700,color:'#000000',x:25,y:37,width:50,size:140,fadeIn:0,fadeOut:0,rise:false});
      return validateProject(p);
    }
    function black(value) {let count=0,first=null;for(let y=125;y<245;y++)for(let x=80;x<280;x++){const i=(y*360+x)*4;if(value[i]<20&&value[i+1]<20&&value[i+2]<20&&value[i+3]>200){count++;first??={x,y};}}return{count,first};}
    function redBounds(value) {
      let left=360,right=-1,top=360,bottom=-1;
      for(let y=0;y<360;y++)for(let x=0;x<360;x++){const i=(y*360+x)*4;if(value[i]>200&&value[i+1]<30&&value[i+2]<30&&value[i+3]>200){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}}
      if(right<left)return null;
      return{x:left/3.6,y:top/3.6,width:(right-left+1)/3.6,height:(bottom-top+1)/3.6};
    }
    function flatSelection(value) {
      const visible=redBounds(value),bounds=engine.projectedBounds('cube');
      return{visible,bounds,pick:visible?engine.pick((visible.x+visible.width/2)/100,(visible.y+visible.height/2)/100):null,marginPick:engine.pick(.21,.21)};
    }
    window.exerciseSharedScene=async()=>{
      await assets();const result={};
      const cube=await mount(modelProject());result.cube={center:center(cube),pick:engine.pick(.5,.5),bounds:engine.projectedBounds('cube')};
      const front=await patch('plane',{z:40});result.front={center:center(front),pick:engine.pick(.5,.5)};
      const behind=await patch('plane',{z:-40});result.behind={center:center(behind),pick:engine.pick(.5,.5)};
      const middle=await mount(wheelProject());result.wheel={middle:black(middle)};
      result.wheel.behind=black(await patch('title',{z:-60}));
      result.wheel.front=black(await patch('title',{z:60}));
      await patch('title',{z:0});
      const glyph=result.wheel.middle.first;result.wheel.textPick=glyph?engine.pick((glyph.x+.5)/360,(glyph.y+.5)/360):null;
      const legacy=modelProject();legacy.version=13;delete legacy.scene;
      for(const layer of legacy.layers){delete layer.space;delete layer.z;if(['text','media','logo'].includes(layer.type)){delete layer.tilt;delete layer.yaw;}}
      const flat=await mount(legacy);result.legacy={center:center(flat),spaces:project.layers.filter(layer=>['model','media'].includes(layer.type)).map(layer=>layer.space)};
      const flatModel=structuredClone(legacy);flatModel.layers=flatModel.layers.filter(layer=>layer.id==='cube');
      flatModel.layers[0].modelStyle.zoom=.55;
      result.flatBounds={front:flatSelection(await mount(flatModel))};
      const base=structuredClone(project),orbit=structuredClone(base);Object.assign(orbit.scene.camera,{yaw:45,pitch:18,zoom:1.1});
      result.flatBounds.orbit=flatSelection(await mount(orbit));
      const perspective=structuredClone(base);perspective.scene.camera.projection='perspective';
      perspective.layers[0].z=30;
      result.flatBounds.perspective=flatSelection(await mount(perspective));
      result.flatOffscreen=flatSelection(await patch('cube',{x:200}));
      engine.dispose();urls.forEach(url=>URL.revokeObjectURL(url));result.errors=errors;return result;
    };
  ` }, bundle: true, write: false, format: 'iife' });
  const angle = process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d11' : 'gl-egl';
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', `--use-angle=${angle}`, '--force-color-profile=srgb'] });
  t.after(() => browser.close());
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setRequestInterception(true);
  page.on('request', request => /^https?:/.test(request.url()) ? (errors.push('Unexpected external request'),request.abort()) : request.continue());
  await page.setContent('<style>body{margin:0}#stage{position:relative;width:1080px;height:1080px;overflow:hidden;transform:scale(.3333333333333333);transform-origin:0 0}canvas,img,video{display:block}</style><div id="stage"></div>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(() => window.exerciseSharedScene());
  assert.deepEqual(errors, []);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.cube.center, [255,0,0,255], 'the front of actual cube geometry occludes a later plane at Z=0');
  assert.equal(result.cube.pick, 'cube');
  assert.ok(result.cube.bounds.width > 20 && result.cube.bounds.width < 60);
  assert.deepEqual(result.front.center, [0,0,255,255], 'moving the image in front changes actual depth, not layer order');
  assert.equal(result.front.pick, 'plane');
  assert.deepEqual(result.behind.center, [255,0,0,255]);
  assert.equal(result.behind.pick, 'cube');
  assert.equal(result.wheel.behind.count, 0, JSON.stringify(result.wheel));
  assert.ok(result.wheel.middle.count > 100 && result.wheel.middle.count < result.wheel.front.count*.8, `wheel photos pass on both sides of the same text plane: ${JSON.stringify(result.wheel)}`);
  assert.equal(result.wheel.textPick, 'title');
  assert.deepEqual(result.legacy.center, [0,0,255,255], 'old independent presentations retain their original layer-stack appearance');
  assert.deepEqual(result.legacy.spaces, ['flat','flat']);
  for (const [view, selection] of Object.entries(result.flatBounds)) {
    assert.ok(selection.visible, `Flat cube remains visible in ${view}`);
    assert.equal(selection.pick, 'cube', `Flat cube picking follows visible geometry in ${view}`);
    assert.equal(selection.marginPick, null, `transparent canvas margins are not pickable in ${view}`);
    assert.ok(selection.bounds, `Flat ${view} has selectable geometry: ${JSON.stringify(selection)}`);
    for (const edge of ['x', 'y', 'width', 'height']) {
      assert.ok(Math.abs(selection.bounds[edge] - selection.visible[edge]) < 1.5, `Flat ${view} ${edge} follows the model silhouette, not its transparent canvas: ${JSON.stringify(selection)}`);
    }
  }
  assert.ok(Math.abs(result.flatBounds.front.bounds.width - result.flatBounds.orbit.bounds.width) > 1, 'Flat silhouette bounds follow common-camera orbit');
  assert.ok(result.flatBounds.perspective.bounds.width > result.flatBounds.front.bounds.width, 'Flat silhouette bounds include authored depth in perspective');
  assert.equal(result.flatOffscreen.visible, null);
  assert.equal(result.flatOffscreen.bounds, null, 'off-camera Flat model bounds remain null');
});
