import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {build} from 'esbuild';
import puppeteer from 'puppeteer-core';
import {browserCandidates} from '../scripts/renderer-runtime.mjs';
import {blankProject,patchLayer,validateProject} from '../src/project.js';

const executablePath=[process.env.HYPERFRAMES_BROWSER_PATH,...browserCandidates()].find(file=>file&&existsSync(file));

test('texture background projects retain bounded controls and reject unavailable textures',()=>{
  const project=blankProject();
  for(const pattern of ['settle','magnet','warp','pillars','pinch','sphere','twist','watch']){
    const next=patchLayer(project,'background',{mode:'procedural',pattern,patternSpeed:-.75,patternSeed:42,patternFocusX:20,patternFocusY:80});
    assert.deepEqual(validateProject(JSON.parse(JSON.stringify(next))),next);
    assert.equal(next.layers[0].patternSpeed,-.75);
    assert.equal(project.layers[0].mode,'color');
  }
  for(const pattern of ['glow','blinds','remote-shader'])assert.throws(()=>patchLayer(project,'background',{mode:'procedural',pattern}));
});

test('MIT texture fields preserve deterministic motion, loops, colors, zoom and resolution without extra WebGL', {skip:!executablePath&&'Chrome or Edge is required for texture pixels',timeout:180000},async t=>{
  const bundle=await build({stdin:{resolveDir:path.resolve('src'),contents:`
    import {drawProceduralBackground,drawBackgroundPreview,PROCEDURAL_BACKGROUNDS} from './backgrounds.js';
    const canvas=document.createElement('canvas');canvas.width=732;canvas.height=516;
    let webgl=0;const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){if(kind==='webgl2'||kind==='webgl')webgl++;return original.call(this,kind,...args);};
    const base={color:'#101010',patternColor:'#ffffff',patternScale:1,patternIntensity:1,patternSpeed:.2,patternSeed:7,patternFocusX:50,patternFocusY:50,patternVignette:0,patternGrain:0,patternAccent:'#0055ff',patternAccentAmount:0,start:0,end:6};
    function render(layer,time,target=canvas){if(!drawProceduralBackground(target,layer,time))throw new Error('Texture was not drawn');return target.getContext('2d',{willReadFrequently:true}).getImageData(0,0,target.width,target.height).data;}
    function difference(a,b){let changed=0,sum=0;for(let i=0;i<a.length;i+=4){let d=0;for(let c=0;c<3;c++)d+=Math.abs(a[i+c]-b[i+c]);if(d)changed++;sum+=d;}return{changed,mean:sum/(a.length/4*3)};}
    const digest=data=>{let h=2166136261;for(let i=0;i<data.length;i++)h=Math.imul(h^data[i],16777619);return h>>>0;};
    window.exerciseTextures=()=>{const result={patterns:[],webgl:0};for(const {id}of PROCEDURAL_BACKGROUNDS.filter(p=>p.source)){
      const layer={...base,pattern:id},first=render(layer,.4),row={id,digest:digest(first)};
      render(layer,8);row.seek=difference(first,render(layer,.4));
      row.motion=difference(first,render(layer,1.7));row.seed=difference(first,render({...layer,patternSeed:89},.4));row.focus=difference(first,render({...layer,patternFocusX:20,patternFocusY:80},.4));
      row.zoom=difference(first,render({...layer,patternScale:1.5},.4));row.color=difference(first,render({...layer,patternColor:'#ff0000'},.4));row.accent=difference(first,render({...layer,patternAccentAmount:1},.4));
      const frozen={...layer,patternSpeed:0,patternGrain:.4};row.frozen=difference(render(frozen,0),render(frozen,80));
      row.reverse=difference(render({...layer,patternSpeed:-.2},1),render({...layer,patternSpeed:-.4},.5));
      const loop={...layer,patternLoop:true,patternAccentAmount:.7};row.loop=difference(render(loop,0),render(loop,6));row.loopMotion=difference(render(loop,0),render(loop,3));
      row.loopReverse=difference(render(loop,5),render({...loop,patternSpeed:-.2},1));
      const invisible=render({...layer,patternIntensity:0},.4);let wrongBase=0;for(let i=0;i<invisible.length;i+=4)if(invisible[i]!==16||invisible[i+1]!==16||invisible[i+2]!==16||invisible[i+3]!==255)wrongBase++;row.invisible=wrongBase;
      const normal=render(layer,.4),large=document.createElement('canvas');large.width=1464;large.height=1032;render(layer,.4,large);const down=document.createElement('canvas');down.width=732;down.height=516;down.getContext('2d').drawImage(large,0,0,732,516);row.resolution=difference(normal,down.getContext('2d').getImageData(0,0,732,516).data);
      const gray={...layer,color:'#808080',patternIntensity:0};row.grain=difference(render(gray,.4),render({...gray,patternGrain:1},.4));row.vignette=difference(render(gray,.4),render({...gray,patternVignette:1},.4));
      const tile=document.createElement('canvas');tile.width=144;tile.height=81;drawBackgroundPreview(tile,layer);const tilePixels=tile.getContext('2d').getImageData(0,0,144,81).data;let low=255,high=0;for(let i=0;i<tilePixels.length;i+=4){low=Math.min(low,tilePixels[i]);high=Math.max(high,tilePixels[i]);}row.tile={low,high};
      result.patterns.push(row);
    }result.webgl=webgl;return result;};
  `},bundle:true,write:false,format:'iife'});
  const browser=await puppeteer.launch({executablePath,headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});t.after(()=>browser.close());
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setContent('<body></body>');await page.addScriptTag({content:bundle.outputFiles[0].text});const result=await page.evaluate(()=>window.exerciseTextures());
  assert.deepEqual(errors,[]);assert.equal(result.webgl,0,'vector textures must not consume a WebGL context');assert.equal(new Set(result.patterns.map(row=>row.digest)).size,8,'all eight source fields must remain distinct');
  for(const row of result.patterns){for(const key of ['seek','frozen','reverse','loop'])assert.equal(row[key].changed,0,row.id+' '+key);assert.equal(row.invisible,0,row.id+' intensity zero');for(const key of ['motion','seed','focus','zoom','color','accent','loopMotion','grain','vignette'])assert.ok(row[key].changed>100,row.id+' '+key+': '+JSON.stringify(row[key]));assert.ok(row.resolution.mean<5,row.id+' resolution: '+JSON.stringify(row.resolution));}
  for(const row of result.patterns)assert.ok(row.loopReverse.mean<.05,row.id+' loop reverses geometry and accent together: '+JSON.stringify(row.loopReverse));
  for(const row of result.patterns)assert.ok(row.tile.high-row.tile.low>20,row.id+' thumbnail must show visible texture contrast: '+JSON.stringify(row.tile));
});
